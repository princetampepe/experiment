package com.pulse.api;

import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api")
public class PostController {

    private final PostService service;
    private final JwtService jwtService;
    private final AppUserRepository appUserRepository;

    public PostController(PostService service, JwtService jwtService, AppUserRepository appUserRepository) {
        this.service = service;
        this.jwtService = jwtService;
        this.appUserRepository = appUserRepository;
    }

    @GetMapping("/posts")
    public PostDtos.PagedPostsResponse getPosts(
            @RequestParam Optional<String> query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            org.springframework.security.core.Authentication authentication
    ) {
        Long viewerId = resolveViewerId(authentication).orElse(null);
        return service.getPostsPage(query.orElse(""), page, size, viewerId);
    }

    @PostMapping("/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public PostDtos.PostResponse createPost(
            @Valid @RequestBody PostDtos.CreatePostRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return service.createPost(request, principal);
    }

    @PatchMapping("/posts/{id}")
    public PostDtos.PostResponse editPost(
            @PathVariable long id,
            @Valid @RequestBody PostDtos.EditPostRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return service.editPost(id, request, principal);
    }

    @PostMapping("/posts/{id}/engage")
    public PostDtos.PostResponse engage(
            @PathVariable long id,
            @RequestBody Map<String, String> body,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        String action = body.getOrDefault("action", "");
        return service.engage(id, action, principal);
    }

    @PostMapping("/posts/{id}/poll/vote")
    public PostDtos.PostResponse votePoll(
            @PathVariable long id,
            @Valid @RequestBody PostDtos.VotePollRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = requirePrincipal(authentication);
        return service.voteOnPoll(id, request, principal);
    }

    @GetMapping("/posts/{id}/insights")
    public PostDtos.PostInsightsResponse insights(@PathVariable long id) {
        return service.getPostInsights(id);
    }

    @GetMapping(value = "/feed/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamFeed(@RequestParam(name = "token", required = false) String token) {
        if (token != null && !token.isBlank()) {
            String email = jwtService.extractEmail(token);
            appUserRepository.findByEmailIgnoreCase(email)
                    .orElseThrow(() -> new IllegalArgumentException("Invalid stream token"));
        }
        return service.streamFeed();
    }

    @GetMapping("/dashboard")
    public PostDtos.DashboardResponse getDashboard() {
        return service.getDashboard();
    }

    private UserPrincipal requirePrincipal(org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof UserPrincipal principal)) {
            throw new IllegalArgumentException("Authentication required");
        }
        return principal;
    }

    private Optional<Long> resolveViewerId(org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof UserPrincipal principal)) {
            return Optional.empty();
        }
        return Optional.of(principal.id());
    }
}
