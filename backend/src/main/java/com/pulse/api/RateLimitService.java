package com.pulse.api;

import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

@Service
public class RateLimitService {

    private final Map<String, Deque<Long>> requestsByBucket = new ConcurrentHashMap<>();

    public void assertAllowed(String scope, Long actorId, int maxRequests, Duration window) {
        if (actorId == null || maxRequests <= 0) {
            return;
        }

        long now = System.currentTimeMillis();
        long earliestAllowed = now - window.toMillis();
        String key = scope + ":" + actorId;
        Deque<Long> bucket = requestsByBucket.computeIfAbsent(key, ignored -> new ConcurrentLinkedDeque<>());

        synchronized (bucket) {
            while (!bucket.isEmpty() && bucket.peekFirst() < earliestAllowed) {
                bucket.pollFirst();
            }
            if (bucket.size() >= maxRequests) {
                throw new RateLimitException("Too many " + scope + " actions. Please wait and try again.");
            }
            bucket.addLast(now);
        }
    }
}
