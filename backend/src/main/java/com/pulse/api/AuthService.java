package com.pulse.api;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@Transactional
public class AuthService {

    private final AppUserRepository appUserRepository;
    private final FollowRepository followRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(
            AppUserRepository appUserRepository,
            FollowRepository followRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService
    ) {
        this.appUserRepository = appUserRepository;
        this.followRepository = followRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    public PostDtos.AuthResponse register(PostDtos.RegisterRequest request) {
        String email = request.email().trim().toLowerCase();
        String handle = normalizeHandle(request.handle());

        if (appUserRepository.existsByEmailIgnoreCase(email)) {
            throw new IllegalArgumentException("Email already exists");
        }
        if (appUserRepository.existsByHandleIgnoreCase(handle)) {
            throw new IllegalArgumentException("Handle already exists");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setHandle(handle);
        user.setDisplayName(request.displayName().trim());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setBio("Building in public with glassmorphism vibes.");
        user.setCreatedAt(Instant.now());

        AppUser saved = appUserRepository.save(user);
        return issueTokens(saved);
    }

    public PostDtos.AuthResponse login(PostDtos.LoginRequest request) {
        String email = request.email().trim().toLowerCase();
        AppUser user = appUserRepository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new IllegalArgumentException("Invalid credentials"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid credentials");
        }

        return issueTokens(user);
    }

    public PostDtos.AuthResponse refresh(String refreshToken) {
        String token = refreshToken == null ? "" : refreshToken.trim();
        if (token.isEmpty()) {
            throw new IllegalArgumentException("Refresh token is required");
        }
        if (!jwtService.isRefreshToken(token)) {
            throw new IllegalArgumentException("Invalid refresh token");
        }

        String email = jwtService.extractEmail(token);
        AppUser user = appUserRepository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));

        if (user.getRefreshTokenHash() == null || user.getRefreshTokenExpiresAt() == null) {
            throw new IllegalArgumentException("Refresh session expired");
        }

        if (user.getRefreshTokenExpiresAt().isBefore(Instant.now())) {
            clearRefreshToken(user);
            throw new IllegalArgumentException("Refresh session expired");
        }

        String suppliedHash = jwtService.hashToken(token);
        if (!suppliedHash.equals(user.getRefreshTokenHash())) {
            throw new IllegalArgumentException("Invalid refresh token");
        }

        return issueTokens(user);
    }

    public void logout(UserPrincipal principal) {
        AppUser user = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        clearRefreshToken(user);
    }

    public PostDtos.UserProfileResponse me(UserPrincipal principal) {
        AppUser user = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        return toProfile(user, user.getId());
    }

    public PostDtos.UserProfileResponse toProfile(AppUser user, Long currentUserId) {
        return new PostDtos.UserProfileResponse(
                user.getId(),
                user.getEmail(),
                user.getHandle(),
                user.getDisplayName(),
                user.getBio(),
                followRepository.countByFollowingId(user.getId()),
                followRepository.countByFollowerId(user.getId()),
                currentUserId != null && !currentUserId.equals(user.getId())
                        && followRepository.findByFollowerIdAndFollowingId(currentUserId, user.getId()).isPresent()
        );
    }

    private String normalizeHandle(String value) {
        String trimmed = value.trim();
        if (!trimmed.startsWith("@")) {
            return "@" + trimmed.toLowerCase();
        }
        return trimmed.toLowerCase();
    }

    private PostDtos.AuthResponse issueTokens(AppUser user) {
        String accessToken = jwtService.generateAccessToken(user);
        String refreshToken = jwtService.generateRefreshToken(user);
        user.setRefreshTokenHash(jwtService.hashToken(refreshToken));
        user.setRefreshTokenExpiresAt(jwtService.extractExpiration(refreshToken));
        appUserRepository.save(user);
        return new PostDtos.AuthResponse(accessToken, refreshToken, toProfile(user, user.getId()));
    }

    private void clearRefreshToken(AppUser user) {
        user.setRefreshTokenHash(null);
        user.setRefreshTokenExpiresAt(null);
        appUserRepository.save(user);
    }
}
