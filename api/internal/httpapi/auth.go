package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oapi-codegen/nullable"
	"waypoint/internal/db"
)

func rollback(ctx context.Context, tx pgx.Tx) {
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		slog.Error("Rollback failed", "error", err)
	}
}
func timestamp(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func publicUser(u db.User) User {
	avatar := nullable.NewNullNullable[string]()
	if u.AvatarUrl.Valid {
		avatar.Set(u.AvatarUrl.String)
	}
	return User{Id: uuid.UUID(u.ID.Bytes), Email: u.Email, Nickname: u.Nickname, AvatarUrl: avatar, EmailVerified: u.EmailVerifiedAt.Valid}
}
func normalizeEmail(v string) (string, error) {
	v = strings.ToLower(strings.TrimSpace(v))
	a, err := mail.ParseAddress(v)
	if err != nil || a.Address != v || len(v) > 254 || !strings.Contains(v, "@") {
		return "", fail(400, "invalid_email", "请输入有效邮箱")
	}
	return v, nil
}
func validPassword(v string) bool { return utf8.RuneCountInString(v) >= 8 && len(v) <= 1024 }
func validNickname(v string) bool {
	return strings.TrimSpace(v) != "" && utf8.RuneCountInString(v) <= 100
}
func validDelivery(v string) bool { return v == "" || v == "cookie" || v == "bearer" }
func (s *Server) rate(ctx context.Context, email string) error {
	st := state(ctx)
	now := time.Now()
	for _, item := range []struct {
		l   *limiter
		key string
	}{{s.ipLimit, clientIP(st.r, s.config.TrustedProxies)}, {s.accountLimit, email}} {
		if ok, retry := item.l.allow(item.key, now); !ok {
			st.w.Header().Set("Retry-After", strconv.Itoa(retry))
			return fail(429, "rate_limited", "请求过于频繁，请稍后再试")
		}
	}
	return nil
}
func (s *Server) session(ctx context.Context, q *db.Queries, u db.User) (string, db.Session, error) {
	token := newToken()
	st := state(ctx)
	session, err := q.CreateSession(ctx, db.CreateSessionParams{UserID: u.ID, TokenHash: tokenHash(token), ExpiresAt: timestamp(time.Now().Add(30 * 24 * time.Hour)), UserAgent: st.r.UserAgent(), Ip: clientIP(st.r, s.config.TrustedProxies)})
	return token, session, err
}
func (s *Server) deliver(ctx context.Context, u db.User, session db.Session, token, delivery string) AuthResult {
	result := AuthResult{User: publicUser(u)}
	if delivery == "bearer" {
		result.Token = &token
	} else {
		http.SetCookie(state(ctx).w, s.cookie("wp_session", token, session.ExpiresAt.Time, true))
	}
	return result
}
func (s *Server) issueEmail(ctx context.Context, q *db.Queries, u db.User, purpose string) (Mail, error) {
	if err := q.InvalidateEmailTokens(ctx, db.InvalidateEmailTokensParams{UserID: u.ID, Purpose: purpose}); err != nil {
		return Mail{}, err
	}
	token := newToken()
	ttl := 24 * time.Hour
	path := "/verify-email"
	subject := "验证您的 Waypoint 邮箱"
	if purpose == "reset_password" {
		ttl = 30 * time.Minute
		path = "/reset-password"
		subject = "重置您的 Waypoint 密码"
	}
	if err := q.CreateEmailToken(ctx, db.CreateEmailTokenParams{UserID: u.ID, Purpose: purpose, TokenHash: tokenHash(token), ExpiresAt: timestamp(time.Now().Add(ttl))}); err != nil {
		return Mail{}, err
	}
	link := strings.TrimRight(s.config.PublicBaseURL, "/") + path + "?token=" + url.QueryEscape(token)
	return Mail{To: u.Email, Subject: subject, Body: "请点击以下链接完成操作（链接仅可使用一次）：\n" + link + "\n如果不是您本人操作，请忽略此邮件。"}, nil
}
func (s *Server) GetCSRF(ctx context.Context, _ GetCSRFRequestObject) (GetCSRFResponseObject, error) {
	return GetCSRF200JSONResponse{Body: CSRF{Token: state(ctx).csrf}}, nil
}
func (s *Server) Register(ctx context.Context, r RegisterRequestObject) (RegisterResponseObject, error) {
	b := r.Body
	if b == nil {
		return nil, fail(400, "invalid_request", "请填写注册信息")
	}
	email, err := normalizeEmail(b.Email)
	if err != nil {
		return nil, err
	}
	if err := s.rate(ctx, email); err != nil {
		return nil, err
	}
	delivery := ""
	if b.TokenDelivery != nil {
		delivery = string(*b.TokenDelivery)
	}
	if !validPassword(b.Password) || !validNickname(b.Nickname) || !validDelivery(delivery) {
		return nil, fail(400, "invalid_request", "密码至少八位，昵称不能为空，令牌交付方式须有效")
	}
	hash := hashPassword(b.Password)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, err := q.CreateUser(ctx, db.CreateUserParams{Email: email, PasswordHash: hash, Nickname: b.Nickname})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return nil, fail(409, "email_exists", "该邮箱已注册")
		}
		return nil, err
	}
	token, session, err := s.session(ctx, q, u)
	if err != nil {
		return nil, err
	}
	message, err := s.issueEmail(ctx, q, u, "verify_email")
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.mail.enqueue(message)
	return Register200JSONResponse{Body: s.deliver(ctx, u, session, token, delivery)}, nil
}
func (s *Server) Login(ctx context.Context, r LoginRequestObject) (LoginResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请填写登录信息")
	}
	b := r.Body
	email, err := normalizeEmail(b.Email)
	if err != nil {
		return nil, err
	}
	if err := s.rate(ctx, email); err != nil {
		return nil, err
	}
	delivery := ""
	if b.TokenDelivery != nil {
		delivery = string(*b.TokenDelivery)
	}
	if !validDelivery(delivery) || len(b.Password) > 1024 {
		return nil, fail(400, "invalid_request", "请求参数不正确")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	if err := q.EnsureLoginFailures(ctx, email); err != nil {
		return nil, err
	}
	failures, err := q.LockLoginFailures(ctx, email)
	if err != nil {
		return nil, err
	}
	if failures.LockedUntil.Valid && failures.LockedUntil.Time.After(time.Now()) {
		return nil, fail(401, "account_locked", "账号暂时锁定，请十五分钟后重试")
	}
	u, err := q.UserByEmail(ctx, email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	exists := err == nil
	if exists {
		u, err = q.LockUser(ctx, u.ID)
		if err != nil {
			return nil, err
		}
	}
	valid := false
	if exists {
		valid = checkPassword(b.Password, u.PasswordHash)
	} else {
		hashPassword(b.Password)
	}
	if !valid {
		f, err := q.RecordLoginFailure(ctx, email)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		if f.LockedUntil.Valid {
			return nil, fail(401, "account_locked", "账号暂时锁定，请十五分钟后重试")
		}
		return nil, fail(401, "invalid_credentials", "邮箱或密码错误")
	}
	if err := q.ClearLoginFailures(ctx, email); err != nil {
		return nil, err
	}
	token, session, err := s.session(ctx, q, u)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return Login200JSONResponse{Body: s.deliver(ctx, u, session, token, delivery)}, nil
}
func (s *Server) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	if err := s.queries.DeleteSession(ctx, state(ctx).session.ID); err != nil {
		return nil, err
	}
	cookie := s.cookie("wp_session", "", time.Unix(1, 0), true)
	cookie.MaxAge = -1
	http.SetCookie(state(ctx).w, cookie)
	return Logout200JSONResponse{Body: Success{Message: "已退出登录"}}, nil
}
func (s *Server) GetMe(ctx context.Context, _ GetMeRequestObject) (GetMeResponseObject, error) {
	return GetMe200JSONResponse{Body: publicUser(state(ctx).user)}, nil
}
func (s *Server) UpdateMe(ctx context.Context, r UpdateMeRequestObject) (UpdateMeResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请填写用户资料")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, err := q.LockUser(ctx, state(ctx).user.ID)
	if err != nil {
		return nil, err
	}
	if r.Body.Nickname != nil {
		if !validNickname(*r.Body.Nickname) {
			return nil, fail(400, "invalid_nickname", "昵称不能为空且最多一百字")
		}
		u.Nickname = *r.Body.Nickname
	}
	if r.Body.AvatarUrl.IsSpecified() {
		v := r.Body.AvatarUrl.GetOrEmpty()
		parsed, err := url.Parse(v)
		if len(v) > 2048 || (v != "" && (err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http"))) {
			return nil, fail(400, "invalid_avatar_url", "请输入有效头像网址")
		}
		u.AvatarUrl = pgtype.Text{String: v, Valid: v != ""}
	}
	u, err = q.UpdateProfile(ctx, db.UpdateProfileParams{ID: u.ID, Nickname: u.Nickname, AvatarUrl: u.AvatarUrl})
	if err != nil {
		return nil, err
	}
	trips, err := s.profileOps(ctx, q, u)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	for _, id := range trips {
		s.hub.notify(id)
	}
	return UpdateMe200JSONResponse{Body: publicUser(u)}, nil
}
func (s *Server) ResendVerification(ctx context.Context, _ ResendVerificationRequestObject) (ResendVerificationResponseObject, error) {
	u := state(ctx).user
	if err := s.rate(ctx, u.Email); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, err = q.LockUser(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	if !u.EmailVerifiedAt.Valid {
		m, err := s.issueEmail(ctx, q, u, "verify_email")
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		s.mail.enqueue(m)
	}
	return ResendVerification200JSONResponse{Body: Success{Message: "验证邮件已发送"}}, nil
}
func (s *Server) ForgotPassword(ctx context.Context, r ForgotPasswordRequestObject) (ForgotPasswordResponseObject, error) {
	if r.Body == nil {
		return nil, fail(400, "invalid_request", "请输入邮箱")
	}
	email, err := normalizeEmail(r.Body.Email)
	if err != nil {
		return nil, err
	}
	if err := s.rate(ctx, email); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	u, err := q.UserByEmail(ctx, email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		u, err = q.LockUser(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		m, err := s.issueEmail(ctx, q, u, "reset_password")
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		s.mail.enqueue(m)
	}
	return ForgotPassword200JSONResponse{Body: Success{Message: "如果该邮箱已注册，您将收到密码重置邮件"}}, nil
}
func invalidToken() error {
	return fail(400, "invalid_token", "链接无效或已过期，请重新申请")
}
func (s *Server) consume(ctx context.Context, token, purpose, password string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	t, err := q.EmailTokenByHash(ctx, db.EmailTokenByHashParams{TokenHash: tokenHash(token), Purpose: purpose})
	if errors.Is(err, pgx.ErrNoRows) {
		return invalidToken()
	}
	if err != nil {
		return err
	}
	if _, err := q.LockUser(ctx, t.UserID); err != nil {
		return err
	}
	if _, err := q.ConsumeEmailToken(ctx, t.ID); errors.Is(err, pgx.ErrNoRows) {
		return invalidToken()
	} else if err != nil {
		return err
	}
	if purpose == "verify_email" {
		if err := q.VerifyUser(ctx, t.UserID); err != nil {
			return err
		}
	} else {
		if err := q.SetPassword(ctx, db.SetPasswordParams{ID: t.UserID, PasswordHash: password}); err != nil {
			return err
		}
		if err := q.DeleteUserSessions(ctx, t.UserID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Server) VerifyEmail(ctx context.Context, r VerifyEmailRequestObject) (VerifyEmailResponseObject, error) {
	if r.Body == nil {
		return nil, invalidToken()
	}
	if err := s.consume(ctx, r.Body.Token, "verify_email", ""); err != nil {
		return nil, err
	}
	return VerifyEmail200JSONResponse{Body: Success{Message: "邮箱验证成功"}}, nil
}
func (s *Server) ResetPassword(ctx context.Context, r ResetPasswordRequestObject) (ResetPasswordResponseObject, error) {
	if r.Body == nil || !validPassword(r.Body.NewPassword) {
		return nil, fail(400, "invalid_password", "密码至少八位且不超过一千零二十四字节")
	}
	if err := s.consume(ctx, r.Body.Token, "reset_password", hashPassword(r.Body.NewPassword)); err != nil {
		return nil, err
	}
	return ResetPassword200JSONResponse{Body: Success{Message: "密码已重置，请重新登录"}}, nil
}
func (s *Server) ChangePassword(ctx context.Context, r ChangePasswordRequestObject) (ChangePasswordResponseObject, error) {
	if r.Body == nil || !validPassword(r.Body.NewPassword) || len(r.Body.OldPassword) > 1024 {
		return nil, fail(400, "invalid_password", "请输入有效的新旧密码，新密码至少八位")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	q := s.queries.WithTx(tx)
	st := state(ctx)
	u, err := q.LockUser(ctx, st.user.ID)
	if err != nil {
		return nil, err
	}
	if !checkPassword(r.Body.OldPassword, u.PasswordHash) {
		return nil, fail(400, "invalid_credentials", "旧密码不正确")
	}
	if err := q.SetPassword(ctx, db.SetPasswordParams{ID: u.ID, PasswordHash: hashPassword(r.Body.NewPassword)}); err != nil {
		return nil, err
	}
	if err := q.DeleteOtherSessions(ctx, db.DeleteOtherSessionsParams{UserID: u.ID, ID: st.session.ID}); err != nil {
		return nil, err
	}
	if err := q.InvalidateEmailTokens(ctx, db.InvalidateEmailTokensParams{UserID: u.ID, Purpose: "reset_password"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return ChangePassword200JSONResponse{Body: Success{Message: "密码已修改"}}, nil
}
