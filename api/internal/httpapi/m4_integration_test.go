package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"waypoint/internal/config"
	"waypoint/internal/db"
)

func TestM4FilesIntegration(t *testing.T) {
	f := syncFixture(t)
	root := t.TempDir()
	s := &Server{pool: f.pool, queries: db.New(f.pool), config: config.Config{UploadDir: root, MaxUploadMB: 1, SigningKey: "test-signing-key"}, storage: LocalStorage{root}, hub: newEventHub()}
	f.handler = newHandler(s)
	ctx := context.Background()
	upload := func(id, mime, token string, data []byte, want int) {
		t.Helper()
		req := httptest.NewRequest("PUT", "/api/trips/"+f.trip+"/files/"+id, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", mime)
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("upload want %d got %d: %s", want, w.Code, w.Body)
		}
		pending, err := os.ReadDir(filepath.Join(root, ".pending"))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		if len(pending) != 0 {
			t.Fatal("temporary upload retained", pending)
		}
	}
	pdf, png := []byte("%PDF-1.4\nfixture"), []byte{137, 80, 78, 71, 13, 10, 26, 10, 0}
	id := uuid.NewString()
	upload(id, "application/pdf", f.a, png, 415)
	upload(id, "image/heic", f.a, []byte("heic"), 415)
	upload(id, "application/pdf", f.a, append(pdf, make([]byte, 1024*1024)...), 413)
	upload(id, "application/pdf", f.a, pdf, 200)
	upload(id, "application/pdf", f.a, pdf, 200)
	upload(id, "application/pdf", f.a, append(pdf, 'x'), 409)
	upload(id, "application/pdf", f.b, pdf, 409)
	outsider := authFixture(t)
	token := outsider.register(false)
	upload(uuid.NewString(), "application/pdf", token, pdf, 403)
	linkPath := "/api/trips/" + f.trip + "/files/" + id + "/link"
	f.expect(f.call("POST", linkPath, nil, token, false, false), 403)
	f.expect(f.call("POST", linkPath, nil, f.b, false, false), 403)
	private := uuid.NewString()
	fields := map[string]any{"type": "visa", "title": "私有签证", "fileId": id, "mime": "application/pdf", "size": len(pdf), "visibility": "private"}
	push := func(actor, token, id, kind string, fields map[string]any, code string) {
		t.Helper()
		op := f.op(actor, id, kind, fields, nil)
		op.Entity = "voucher"
		r := f.push(token, op)[0]
		if code == "" {
			if r.Status != Accepted {
				t.Fatalf("voucher: %+v", r)
			}
		} else if r.Error == nil || r.Error.Code != code {
			t.Fatalf("want %s got %+v", code, r)
		}
	}
	before := f.expect(f.call("GET", "/api/trips/"+f.trip+"/snapshot", nil, f.b, false, false), 200)
	push(f.userA, f.a, private, "create", fields, "")
	push(f.userA, f.a, private, "update", map[string]any{"visibility": "trip"}, "invalid_op")
	push(f.userB, f.b, private, "update", map[string]any{"title": "leak"}, "forbidden_field")
	push(f.userB, f.b, private, "delete", nil, "forbidden_field")
	after := f.expect(f.call("GET", "/api/trips/"+f.trip+"/snapshot", nil, f.b, false, false), 200)
	if len(before["entities"].([]any)) != len(after["entities"].([]any)) {
		t.Fatal("private entity count leaked")
	}
	for _, suffix := range []string{"snapshot", "ops?after=0", "history", "history?entity=voucher&entityId=" + private} {
		w := f.call("GET", "/api/trips/"+f.trip+"/"+suffix, nil, f.b, false, false)
		f.expect(w, 200)
		for _, secret := range []string{private, id, "私有签证"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("private data leaked via %s", suffix)
			}
		}
	}
	f.expect(f.call("POST", linkPath, nil, f.b, false, false), 403)
	signed := f.expect(f.call("POST", linkPath, nil, f.a, false, false), 200)["url"].(string)
	get := func(path string, want int, rangeHeader string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		w := httptest.NewRecorder()
		f.handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("download want %d got %d %s", want, w.Code, w.Body)
		}
		return w
	}
	got := get(signed, 200, "")
	if !bytes.Equal(got.Body.Bytes(), pdf) {
		t.Fatal("download bytes changed")
	}
	for k, v := range map[string]string{"Content-Type": "application/pdf", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cache-Control": "private, max-age=300", "Content-Security-Policy": "sandbox"} {
		if got.Header().Get(k) != v {
			t.Fatalf("missing %s", k)
		}
	}
	if get(signed, 206, "bytes=0-4").Body.String() != "%PDF-" {
		t.Fatal("range failed")
	}
	parsed, _ := url.Parse(signed)
	p := parsed.Query()
	p.Set("u", f.userB)
	parsed.RawQuery = p.Encode()
	get(parsed.String(), 403, "")
	get(strings.Replace(signed, "sig=", "sig=0", 1), 403, "")
	exp := time.Now().Add(-time.Second).Unix()
	get(fmt.Sprintf("/api/files/%s?exp=%d&sig=%s&u=%s", id, exp, s.signature(uuid.MustParse(id), exp, uuid.MustParse(f.userA)), f.userA), 403, "")
	// 共享凭证可由其他成员取链接；owner 仅可删除共享凭证，不能恢复他人凭证。
	sharedFile := uuid.NewString()
	upload(sharedFile, "application/pdf", f.b, pdf, 200)
	shared := uuid.NewString()
	fields["fileId"] = sharedFile
	fields["visibility"] = "trip"
	push(f.userB, f.b, shared, "create", fields, "")
	sharedLink := "/api/trips/" + f.trip + "/files/" + sharedFile + "/link"
	f.expect(f.call("POST", sharedLink, nil, f.a, false, false), 200)
	push(f.userA, f.a, shared, "delete", nil, "")
	push(f.userA, f.a, shared, "restore", nil, "forbidden_field")
	f.expect(f.call("POST", sharedLink, nil, f.a, false, false), 403)
	push(f.userB, f.b, shared, "restore", nil, "")
	push(f.userB, f.b, shared, "delete", nil, "")
	orphan := uuid.NewString()
	upload(orphan, "application/pdf", f.a, pdf, 200)
	if err := s.cleanOrphanFiles(ctx, time.Now().Add(23*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, f.trip, orphan)); err != nil {
		t.Fatal("early cleanup", err)
	}
	if err := s.cleanOrphanFiles(ctx, time.Now().Add(25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, f.trip, orphan)); !os.IsNotExist(err) {
		t.Fatal("orphan retained", err)
	}
	for _, file := range []string{id, sharedFile} {
		if _, err := os.Stat(filepath.Join(root, f.trip, file)); err != nil {
			t.Fatal("referenced file removed", err)
		}
	}
	f.expect(f.call("DELETE", "/api/trips/"+f.trip, nil, f.a, false, false), 200)
	if _, err := os.Stat(filepath.Join(root, f.trip)); !os.IsNotExist(err) {
		t.Fatal("trip directory retained", err)
	}
	var count int
	if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM files WHERE trip_id=$1", f.trip).Scan(&count); err != nil || count != 0 {
		t.Fatal("file rows retained", count, err)
	}
}

type observedUploadStorage struct {
	Storage
	started chan struct{}
}

func (s observedUploadStorage) Stage(data io.Reader) (StagedFile, error) {
	close(s.started)
	return s.Storage.Stage(data)
}

func TestM4SlowUploadDoesNotBlockOpsIntegration(t *testing.T) {
	f := syncFixture(t)
	root := t.TempDir()
	started := make(chan struct{})
	s := &Server{pool: f.pool, queries: db.New(f.pool), config: config.Config{MaxUploadMB: 1}, storage: observedUploadStorage{LocalStorage{root}, started}, hub: newEventHub()}
	f.handler = newHandler(s)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	reader, writer := io.Pipe()
	defer func() {
		if err := reader.Close(); err != nil {
			t.Error(err)
		}
		if err := writer.Close(); err != nil {
			t.Error(err)
		}
	}()
	release := make(chan struct{})
	written := make(chan error, 1)
	go func() {
		prefix := append([]byte("%PDF-1.4\n"), make([]byte, 503)...)
		if _, err := writer.Write(prefix); err != nil {
			written <- err
			return
		}
		// 将后半段停在管道中，模拟弱网；只有 op 已返回才继续发送。
		select {
		case <-release:
		case <-ctx.Done():
			written <- ctx.Err()
			return
		}
		_, err := writer.Write([]byte("remaining PDF bytes"))
		written <- errors.Join(err, writer.Close())
	}()
	id := uuid.NewString()
	req := httptest.NewRequestWithContext(ctx, "PUT", "/api/trips/"+f.trip+"/files/"+id, reader)
	req.Header.Set("Authorization", "Bearer "+f.a)
	req.Header.Set("Content-Type", "application/pdf")
	uploaded := make(chan *httptest.ResponseRecorder, 1)
	go func() { w := httptest.NewRecorder(); f.handler.ServeHTTP(w, req); uploaded <- w }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("upload did not reach streaming storage before EOF")
	}
	op := f.op(f.userA, uuid.NewString(), "create", map[string]any{"title": "upload in progress", "date": "2026-12-01"}, nil)
	data, err := json.Marshal(PushBody{Ops: []ClientOp{op}})
	if err != nil {
		t.Fatal(err)
	}
	opReq := httptest.NewRequest("POST", "/api/trips/"+f.trip+"/ops", bytes.NewReader(data))
	opReq.Header.Set("Authorization", "Bearer "+f.a)
	opReq.Header.Set("Content-Type", "application/json")
	pushed := make(chan *httptest.ResponseRecorder, 1)
	go func() { w := httptest.NewRecorder(); f.handler.ServeHTTP(w, opReq); pushed <- w }()
	select {
	case w := <-pushed:
		f.expect(w, 200)
		var result PushResult
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Results) != 1 || result.Results[0].Status != Accepted {
			t.Fatalf("op not accepted: %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("same-trip op blocked by slow upload for more than one second")
	}
	select {
	case w := <-uploaded:
		t.Fatalf("upload completed before remaining bytes: %d %s", w.Code, w.Body)
	default:
	}
	close(release)
	if err := <-written; err != nil {
		t.Fatal(err)
	}
	select {
	case w := <-uploaded:
		f.expect(w, 200)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}
