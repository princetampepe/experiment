package com.pulse.api;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class FeedStreamService {

    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);

        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(ignored -> emitters.remove(emitter));

        try {
            emitter.send(SseEmitter.event().name("connected").data("ok"));
        } catch (IOException exception) {
            emitters.remove(emitter);
        }

        return emitter;
    }

    public void publish(PostDtos.FeedEventResponse payload) {
        if (payload == null) {
            return;
        }

        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("feed").data(payload));
            } catch (IOException exception) {
                emitters.remove(emitter);
            }
        }
    }
}
