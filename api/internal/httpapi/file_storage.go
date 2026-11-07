package httpapi

import (
	"errors"
	"io"
	"os"
	"path/filepath"
)

type Storage interface {
	Put(trip, file string, data io.Reader) error
	Stage(data io.Reader) (StagedFile, error)
	Open(trip, file string) (*os.File, error)
	Delete(trip, file string) error
}

type StagedFile interface {
	Size() int64
	Commit(trip, file string) error
	Discard() error
}

type LocalStorage struct{ Root string }

func (s LocalStorage) Put(trip, file string, data io.Reader) error {
	staged, err := s.Stage(data)
	if err != nil {
		return err
	}
	defer func() {
		if err := staged.Discard(); err != nil {
			logFileError(err)
		}
	}()
	return staged.Commit(trip, file)
}

func (s LocalStorage) Stage(data io.Reader) (_ StagedFile, err error) {
	// 暂存目录独立于行程目录，上传期间删除行程不会删除正在接收的文件。
	dir := filepath.Join(s.Root, ".pending")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp(dir, ".upload-")
	if err != nil {
		return nil, err
	}
	closed := false
	defer func() {
		if err != nil {
			if !closed {
				err = errors.Join(err, f.Close())
			}
			err = errors.Join(err, os.Remove(f.Name()))
		}
	}()
	size, err := io.Copy(f, data)
	if err != nil {
		return nil, err
	}
	if err = f.Sync(); err != nil {
		return nil, err
	}
	err = f.Close()
	closed = true
	if err != nil {
		return nil, err
	}
	return &localStagedFile{root: s.Root, path: f.Name(), size: size}, nil
}

type localStagedFile struct {
	root, path string
	size       int64
}

func (f *localStagedFile) Size() int64 { return f.size }
func (f *localStagedFile) Commit(trip, file string) error {
	dir := filepath.Join(f.root, trip)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return os.Rename(f.path, filepath.Join(dir, file))
}
func (f *localStagedFile) Discard() error {
	err := os.Remove(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func (s LocalStorage) Open(trip, file string) (*os.File, error) {
	return os.Open(filepath.Join(s.Root, trip, file))
}
func (s LocalStorage) Delete(trip, file string) error {
	err := os.RemoveAll(filepath.Join(s.Root, trip, file))
	return err
}
