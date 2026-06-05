import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GameDb, createDb } from './db.js';

let db: GameDb;

beforeEach(() => {
	db = createDb({ path: ':memory:' });
	db.init();
});

afterEach(() => {
	db.close();
});

describe('signup queue', () => {
	it('queues and retrieves players in FIFO order', () => {
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		db.queuePlayer('did:plc:bbb', 'bob.bsky.social');

		const queue = db.getQueue();
		expect(queue).toHaveLength(2);
		expect(queue[0]?.did).toBe('did:plc:aaa');
		expect(queue[1]?.did).toBe('did:plc:bbb');
	});

	it('returns correct queue size', () => {
		expect(db.getQueueSize()).toBe(0);
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		expect(db.getQueueSize()).toBe(1);
		db.queuePlayer('did:plc:bbb', 'bob.bsky.social');
		expect(db.getQueueSize()).toBe(2);
	});

	it('checks if a player is queued', () => {
		expect(db.isQueued('did:plc:aaa')).toBe(false);
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		expect(db.isQueued('did:plc:aaa')).toBe(true);
		expect(db.isQueued('did:plc:bbb')).toBe(false);
	});

	it('dequeues a single player', () => {
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		db.queuePlayer('did:plc:bbb', 'bob.bsky.social');
		db.dequeuePlayer('did:plc:aaa');

		expect(db.getQueueSize()).toBe(1);
		expect(db.isQueued('did:plc:aaa')).toBe(false);
		expect(db.isQueued('did:plc:bbb')).toBe(true);
	});

	it('dequeues multiple players in batch', () => {
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		db.queuePlayer('did:plc:bbb', 'bob.bsky.social');
		db.queuePlayer('did:plc:ccc', 'carol.bsky.social');
		db.dequeuePlayers(['did:plc:aaa', 'did:plc:bbb']);

		expect(db.getQueueSize()).toBe(1);
		const queue = db.getQueue();
		expect(queue[0]?.did).toBe('did:plc:ccc');
	});

	it('upserts on duplicate queue entry', () => {
		db.queuePlayer('did:plc:aaa', 'alice.bsky.social');
		db.queuePlayer('did:plc:aaa', 'alice-new.bsky.social');

		expect(db.getQueueSize()).toBe(1);
		const queue = db.getQueue();
		expect(queue[0]?.handle).toBe('alice-new.bsky.social');
	});

	it('dequeue of non-existent player is a no-op', () => {
		db.dequeuePlayer('did:plc:nonexistent');
		expect(db.getQueueSize()).toBe(0);
	});
});
