package com.pulse.api;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.AccessDeniedException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public PostDtos.AuthResponse register(@Valid @RequestBody PostDtos.RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public PostDtos.AuthResponse login(@Valid @RequestBody PostDtos.LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/refresh")
    public PostDtos.AuthResponse refresh(@Valid @RequestBody PostDtos.RefreshTokenRequest request) {
        return authService.refresh(request.refreshToken());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        authService.logout(principal);
    }

    @GetMapping("/me")
    public PostDtos.UserProfileResponse me(org.springframework.security.core.Authentication authentication) {
        UserPrincipal principal = requirePrincipal(authentication);
        return authService.me(principal);
    }

    private UserPrincipal requirePrincipal(org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof UserPrincipal principal)) {
            throw new AccessDeniedException("Authentication required");
        }
        return principal;
    }
}
