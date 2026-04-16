package com.pulse.api;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageService messageService;

    public MessageController(MessageService messageService) {
        this.messageService = messageService;
    }

    @GetMapping("/inbox")
    public List<PostDtos.ConversationSummaryResponse> inbox(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        return messageService.inbox(principal);
    }

    @GetMapping("/thread/{peerId}")
    public List<PostDtos.MessageResponse> thread(
            @PathVariable Long peerId,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return messageService.thread(principal, peerId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PostDtos.MessageResponse send(
            @Valid @RequestBody PostDtos.SendMessageRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return messageService.send(principal, request);
    }

    @PatchMapping("/thread/{peerId}/read")
    public Map<String, String> markRead(
            @PathVariable Long peerId,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        messageService.markThreadRead(principal, peerId);
        return Map.of("status", "ok");
    }

    private UserPrincipal requirePrincipal(org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof UserPrincipal principal)) {
            throw new AccessDeniedException("Authentication required");
        }
        return principal;
    }
}
