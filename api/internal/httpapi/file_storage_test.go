package httpapi

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"testing/iotest"
)

func TestStageRemovesInterruptedUpload(t *testing.T) {
	root := t.TempDir()
	want := errors.New("upload interrupted")
	_, err := (LocalStorage{root}).Stage(io.MultiReader(bytes.NewReader(make([]byte, 1024)), iotest.ErrReader(want)))
	if !errors.Is(err, want) {
		t.Fatalf("want read failure, got %v", err)
	}
	files, err := os.ReadDir(filepath.Join(root, ".pending"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("temporary file retained after read failure", files)
	}
}
