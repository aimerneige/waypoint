package httpapi

import (
	"math"
	"sync"
	"time"
)

type bucket struct {
	tokens  float64
	updated time.Time
}
type limiter struct {
	mu       sync.Mutex
	buckets  map[string]bucket
	capacity float64
	interval time.Duration
}

func newLimiter(capacity int, interval time.Duration) *limiter {
	return &limiter{buckets: make(map[string]bucket), capacity: float64(capacity), interval: interval}
}
func (l *limiter) allow(key string, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	// 清理闲置桶，避免长期运行时保留所有历史来源。
	for k, b := range l.buckets {
		if now.Sub(b.updated) > time.Duration(l.capacity)*l.interval {
			delete(l.buckets, k)
		}
	}
	b, ok := l.buckets[key]
	if !ok {
		b = bucket{tokens: l.capacity, updated: now}
	}
	b.tokens = math.Min(l.capacity, b.tokens+now.Sub(b.updated).Seconds()/l.interval.Seconds())
	b.updated = now
	allowed := b.tokens >= 1
	retry := 0
	if allowed {
		b.tokens--
	} else {
		retry = int(math.Ceil((1 - b.tokens) * l.interval.Seconds()))
	}
	l.buckets[key] = b
	return allowed, retry
}
