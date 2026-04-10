package com.pulse.api;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api")
public class PostController {

    private final PostService service;

    public PostController(PostService service) {
        this.service = service;
    }

    @GetMapping("/posts")
    public PostDtos.PagedPostsResponse getPosts(
            @RequestParam Optional<String> query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size
    ) {
        return service.getPostsPage(query.orElse(""), page, size);
    }

    @PostMapping("/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public PostDtos.PostResponse createPost(
            @Valid @RequestBody PostDtos.CreatePostRequest request,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = (UserPrincipal) authentication.getPrincipal();
        return service.createPost(request, principal);
    }

    @PostMapping("/posts/{id}/engage")
    public PostDtos.PostResponse engage(
            @PathVariable long id,
            @RequestBody Map<String, String> body,
            org.springframework.security.core.Authentication authentication
    ) {
        UserPrincipal principal = (UserPrincipal) authentication.getPrincipal();
        String action = body.getOrDefault("action", "");
        return service.engage(id, action, principal);
    }

    @GetMapping("/dashboard")
    public PostDtos.DashboardResponse getDashboard() {
        return service.getDashboard();
    }
}
