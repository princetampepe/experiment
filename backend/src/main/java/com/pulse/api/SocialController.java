package com.pulse.api;

import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Objects;

@RestController
@RequestMapping("/api")
public class SocialController {

    private final SocialService socialService;
    private final JwtService jwtService;
    private final AppUserRepository appUserRepository;

    public SocialController(SocialService socialService, JwtService jwtService, AppUserRepository appUserRepository) {
        this.socialService = socialService;
        this.jwtService = jwtService;
        this.appUserRepository = appUserRepository;
    }

    @GetMapping("/users/suggested")
    public List<PostDtos.UserProfileResponse> suggestedUsers(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.suggestedUsers(principal);
    }

    @PostMapping("/users/{id}/follow")
    public PostDtos.UserProfileResponse follow(
            @PathVariable("id") Long id,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.follow(principal, id);
    }

    @DeleteMapping("/users/{id}/follow")
    public PostDtos.UserProfileResponse unfollow(
            @PathVariable("id") Long id,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.unfollow(principal, id);
    }

    @GetMapping("/feed/personalized")
    public PostDtos.PagedPostsResponse personalizedFeed(
            @RequestParam(defaultValue = "") String query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.personalizedFeedPage(principal, query, page, size);
    }

    @GetMapping("/notifications")
    public List<PostDtos.NotificationResponse> notifications(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.notifications(principal);
    }

    @GetMapping("/notifications/unread-count")
    public java.util.Map<String, Long> unreadCount(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        return java.util.Map.of("count", socialService.unreadNotificationCount(principal));
    }

    @PatchMapping("/notifications/{id}/read")
    public java.util.Map<String, String> markRead(
            @PathVariable("id") Long id,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        socialService.markNotificationRead(principal, id);
        return java.util.Map.of("status", "ok");
    }

    @GetMapping(value = "/notifications/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamNotifications(
            @RequestParam(name = "token", required = false) String token,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = resolvePrincipal(authentication, token);
        return socialService.streamNotifications(principal);
    }

    @PostMapping("/posts/{id}/comments")
    public PostDtos.CommentResponse addComment(
            @PathVariable("id") Long id,
            @Valid @RequestBody PostDtos.CreateCommentRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return socialService.addComment(principal, id, request);
    }

    @GetMapping("/posts/{id}/comments")
    public List<PostDtos.CommentResponse> comments(@PathVariable("id") Long id) {
        return socialService.comments(id);
    }

    private UserPrincipal resolvePrincipal(org.springframework.security.core.Authentication authentication, String token) {
        if (authentication != null && authentication.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }

        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Authentication required for notification stream");
        }

        String email = jwtService.extractEmail(token);
        AppUser user = appUserRepository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new IllegalArgumentException("Invalid stream token"));

        return new UserPrincipal(
            Objects.requireNonNull(user.getId(), "Authenticated user id is required"),
            user.getEmail(),
            user.getHandle(),
            user.getDisplayName()
        );
    }

    private UserPrincipal requirePrincipal(org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof UserPrincipal principal)) {
            throw new AccessDeniedException("Authentication required");
        }
        return principal;
    }
}
