package com.pulse.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public final class PostDtos {

    private PostDtos() {
    }

    public record CreatePostRequest(
            @Size(max = 60) String author,
            @Size(max = 40) String handle,
            @NotBlank @Size(max = 280) String content,
            List<String> tags
    ) {
    }

    public record RegisterRequest(
            @NotBlank @Size(max = 100) String email,
            @NotBlank @Size(max = 40) String handle,
            @NotBlank @Size(max = 60) String displayName,
            @NotBlank @Size(min = 6, max = 100) String password
    ) {
    }

    public record LoginRequest(
            @NotBlank String email,
            @NotBlank String password
    ) {
    }

    public record AuthResponse(
            String token,
            String refreshToken,
            UserProfileResponse user
    ) {
    }

    public record RefreshTokenRequest(
            @NotBlank String refreshToken
    ) {
    }

    public record UserProfileResponse(
            Long id,
            String email,
            String handle,
            String displayName,
            String bio,
            long followers,
            long following,
            boolean followedByCurrentUser
    ) {
    }

    public record PostResponse(
            Long id,
            String author,
            String handle,
            String content,
            List<String> tags,
            int replyCount,
            int repostCount,
            int likeCount,
            int bookmarkCount,
            int commentCount,
            Instant createdAt
    ) {
    }

    public record PagedPostsResponse(
            List<PostResponse> items,
            int page,
            int size,
            long totalElements,
            boolean hasNext
    ) {
    }

    public record CreateCommentRequest(
            @NotBlank @Size(max = 280) String content
    ) {
    }

    public record CommentResponse(
            Long id,
            Long postId,
            String author,
            String handle,
            String content,
            Instant createdAt
    ) {
    }

    public record NotificationResponse(
            Long id,
            String type,
            String message,
            boolean isRead,
            Instant createdAt
    ) {
    }

    public record DashboardResponse(
            long totalPosts,
            long totalEngagement,
            long averageLikes,
            long savedPosts,
            List<TrendResponse> trends,
            List<Integer> weeklyActivity,
            List<GapItem> missingFunctionalities
    ) {
    }

    public record TrendResponse(String tag, long score) {
    }

    public record GapItem(String area, String whyItMatters, String suggestedImplementation) {
    }
}
