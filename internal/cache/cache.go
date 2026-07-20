package cache

import (
	"sync"
	"time"
)

// entry holds a cached value with its expiration time.
type entry struct {
	value   any
	expires time.Time
}

// Cache is a generic in-memory TTL cache safe for concurrent use.
type Cache struct {
	mu       sync.RWMutex
	items    map[string]*entry
	ttl      time.Duration
	stopCh   chan struct{}
	interval time.Duration
}

// New creates a Cache with the given default TTL and cleanup interval.
func New(ttl time.Duration) *Cache {
	return &Cache{
		items:    make(map[string]*entry),
		ttl:      ttl,
		stopCh:   make(chan struct{}),
		interval: 5 * time.Minute,
	}
}

// Start begins the background cleanup goroutine.
func (c *Cache) Start() {
	go c.cleanup()
}

// Stop terminates the background cleanup goroutine.
func (c *Cache) Stop() {
	close(c.stopCh)
}

// Get retrieves a value by key. Returns nil, false if not found or expired.
func (c *Cache) Get(key string) (any, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.items[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.value, true
}

// Set stores a value with the default TTL.
func (c *Cache) Set(key string, value any) {
	c.SetTTL(key, value, c.ttl)
}

// SetTTL stores a value with a custom TTL.
func (c *Cache) SetTTL(key string, value any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = &entry{
		value:   value,
		expires: time.Now().Add(ttl),
	}
}

// Delete removes a key from the cache.
func (c *Cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
}

// Clear removes all entries.
func (c *Cache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]*entry)
}

// Len returns the number of cached items.
func (c *Cache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
}

// cleanup periodically removes expired entries.
func (c *Cache) cleanup() {
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.purgeExpired()
		case <-c.stopCh:
			return
		}
	}
}

func (c *Cache) purgeExpired() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, e := range c.items {
		if now.After(e.expires) {
			delete(c.items, k)
		}
	}
}
