package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"waypoint/internal/db"
)

type eventSubscription struct {
	user     uuid.UUID
	seq      chan struct{}
	terminal chan string
}
type eventHub struct {
	mu    sync.Mutex
	trips map[uuid.UUID]map[*eventSubscription]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{trips: map[uuid.UUID]map[*eventSubscription]struct{}{}}
}
func (h *eventHub) subscribe(id, user uuid.UUID) (*eventSubscription, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := &eventSubscription{user: user, seq: make(chan struct{}, 1), terminal: make(chan string, 1)}
	if h.trips[id] == nil {
		h.trips[id] = map[*eventSubscription]struct{}{}
	}
	h.trips[id][ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.trips[id], ch)
		if len(h.trips[id]) == 0 {
			delete(h.trips, id)
		}
	}
}
func (h *eventHub) notify(id uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.trips[id] {
		select {
		case ch.seq <- struct{}{}:
		default:
		}
	}
}

func (h *eventHub) terminate(trip, user uuid.UUID, event string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.trips[trip] {
		if user != uuid.Nil && sub.user != user {
			continue
		}
		select {
		case sub.terminal <- event:
		default:
		}
	}
}

// strict server 的流式响应实现自行维护连接生命周期。
type eventResponse struct {
	s           *Server
	ctx         context.Context
	trip        uuid.UUID
	user        uuid.UUID
	sessionHash []byte
}

func (r eventResponse) VisitTripEventsResponse(w http.ResponseWriter) error {
	sub, unsubscribe := r.s.hub.subscribe(r.trip, r.user)
	defer unsubscribe()
	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	checkSession := func() (bool, error) {
		_, err := r.s.queries.SessionByHash(r.ctx, r.sessionHash)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err = fmt.Fprint(w, "event: unauthorized\ndata: {}\n\n"); err != nil {
				return true, err
			}
			return true, controller.Flush()
		}
		return err != nil, err
	}
	// 先订阅再读取序号，避免连接建立与事务提交之间漏通知。
	send := func() (bool, error) {
		if stop, err := checkSession(); stop || err != nil {
			return stop, err
		}
		t, err := r.s.queries.GetTrip(r.ctx, uid(r.trip))
		event := "seq"
		data := "{}"
		if errors.Is(err, pgx.ErrNoRows) {
			event = "trip_deleted"
		} else if err != nil {
			return true, err
		} else {
			m, err := r.s.queries.GetMember(r.ctx, db.GetMemberParams{TripID: t.ID, UserID: uid(r.user)})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.LeftAt.Valid) {
				event = "revoked"
			} else if err != nil {
				return true, err
			} else {
				data = fmt.Sprintf(`{"latestSeq":%d}`, t.LastSeq)
			}
		}
		if _, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
			return true, err
		}
		return event != "seq", controller.Flush()
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	if stop, err := send(); stop || err != nil {
		if err != nil {
			slog.Debug("SSE connection closed", "error", err)
		}
		return nil
	}
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.ctx.Done():
			return nil
		case event := <-sub.terminal:
			if stop, err := checkSession(); stop || err != nil {
				if err != nil {
					slog.Debug("SSE session check failed", "error", err)
				}
				return nil
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event); err != nil {
				return nil
			}
			if err := controller.Flush(); err != nil {
				return nil
			}
			return nil
		case <-sub.seq:
			if stop, err := send(); stop || err != nil {
				if err != nil {
					slog.Debug("SSE connection closed", "error", err)
				}
				return nil
			}
		case <-ticker.C:
			if stop, err := checkSession(); stop || err != nil {
				if err != nil {
					slog.Debug("SSE session check failed", "error", err)
				}
				return nil
			}
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return nil
			}
			if err := controller.Flush(); err != nil {
				return nil
			}
		}
	}
}
func (s *Server) TripEvents(ctx context.Context, r TripEventsRequestObject) (TripEventsResponseObject, error) {
	if _, _, e := s.membership(ctx, s.queries, r.TripId, false, false); e != nil {
		return nil, e
	}
	return eventResponse{s: s, ctx: ctx, trip: r.TripId, user: uuid.UUID(state(ctx).user.ID.Bytes), sessionHash: state(ctx).session.TokenHash}, nil
}
