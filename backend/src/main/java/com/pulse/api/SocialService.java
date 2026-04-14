package com.pulse.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

@Service
@Transactional
public class SocialService {

    private final AppUserRepository appUserRepository;
    private final FollowRepository followRepository;
    private final NotificationRepository notificationRepository;
    private final PostRepository postRepository;
    private final PostCommentRepository postCommentRepository;
    private final PostService postService;
    private final AuthService authService;
    private final NotificationStreamService notificationStreamService;
    private final RateLimitService rateLimitService;
    private final ContentModerationService contentModerationService;

    private final int commentsPerMinute;
    private final int followsPerMinute;

    public SocialService(
            AppUserRepository appUserRepository,
            FollowRepository followRepository,
            NotificationRepository notificationRepository,
            PostRepository postRepository,
            PostCommentRepository postCommentRepository,
            PostService postService,
            AuthService authService,
            NotificationStreamService notificationStreamService,
            RateLimitService rateLimitService,
            ContentModerationService contentModerationService,
            @Value("${app.rate-limit.comments-per-minute:20}") int commentsPerMinute,
            @Value("${app.rate-limit.follows-per-minute:25}") int followsPerMinute
    ) {
        this.appUserRepository = appUserRepository;
        this.followRepository = followRepository;
        this.notificationRepository = notificationRepository;
        this.postRepository = postRepository;
        this.postCommentRepository = postCommentRepository;
        this.postService = postService;
        this.authService = authService;
        this.notificationStreamService = notificationStreamService;
        this.rateLimitService = rateLimitService;
        this.contentModerationService = contentModerationService;
        this.commentsPerMinute = commentsPerMinute;
        this.followsPerMinute = followsPerMinute;
    }

    public List<PostDtos.UserProfileResponse> suggestedUsers(UserPrincipal principal) {
        return appUserRepository.findAll().stream()
                .filter(user -> !user.getId().equals(principal.id()))
                .sorted(Comparator.comparing(AppUser::getCreatedAt).reversed())
                .limit(8)
                .map(user -> authService.toProfile(user, principal.id()))
                .toList();
    }

    public PostDtos.UserProfileResponse follow(UserPrincipal principal, Long targetId) {
        rateLimitService.assertAllowed("follow", principal.id(), followsPerMinute, Duration.ofMinutes(1));

        Long safeTargetId = Objects.requireNonNull(targetId, "Target user id is required");
        if (principal.id().equals(safeTargetId)) {
            throw new IllegalArgumentException("You cannot follow yourself");
        }

        AppUser me = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));
        AppUser target = appUserRepository.findById(safeTargetId)
                .orElseThrow(() -> new IllegalArgumentException("Target user not found"));

        if (followRepository.findByFollowerIdAndFollowingId(me.getId(), target.getId()).isEmpty()) {
            Follow follow = new Follow();
            follow.setFollower(me);
            follow.setFollowing(target);
            follow.setCreatedAt(Instant.now());
            followRepository.save(follow);

            createNotification(target, "follow", me.getDisplayName() + " started following you");
        }

        return authService.toProfile(target, me.getId());
    }

    public PostDtos.UserProfileResponse unfollow(UserPrincipal principal, Long targetId) {
        Long safeTargetId = Objects.requireNonNull(targetId, "Target user id is required");
        AppUser target = appUserRepository.findById(safeTargetId)
                .orElseThrow(() -> new IllegalArgumentException("Target user not found"));

        followRepository.findByFollowerIdAndFollowingId(principal.id(), safeTargetId)
                .ifPresent(followRepository::delete);

        return authService.toProfile(target, principal.id());
    }

    public List<PostDtos.PostResponse> personalizedFeed(UserPrincipal principal, String query) {
        List<Long> followingIds = followRepository.findByFollowerId(principal.id()).stream()
                .map(follow -> follow.getFollowing().getId())
                .toList();

        List<Long> authorIds = new ArrayList<>();
        authorIds.add(principal.id());
        authorIds.addAll(followingIds);

        List<Post> posts = postRepository.findByAuthorUserIdIn(authorIds);
        List<Post> ranked = posts.stream()
                .sorted(Comparator.comparing(Post::getCreatedAt).reversed())
                .toList();
        return postService.toResponses(ranked, query, principal.id());
    }

    public PostDtos.PagedPostsResponse personalizedFeedPage(UserPrincipal principal, String query, int page, int size) {
        List<Long> followingIds = followRepository.findByFollowerId(principal.id()).stream()
                .map(follow -> follow.getFollowing().getId())
                .toList();

        List<Long> authorIds = new ArrayList<>();
        authorIds.add(principal.id());
        authorIds.addAll(followingIds);

        List<Post> posts = postRepository.findByAuthorUserIdIn(authorIds);
        return postService.rankAndPage(posts, query, page, size, principal.id(), followingIds);
    }

    public List<PostDtos.NotificationResponse> notifications(UserPrincipal principal) {
        return notificationRepository.findTop20ByRecipientIdOrderByCreatedAtDesc(principal.id()).stream()
                .map(this::toNotificationResponse)
                .toList();
    }

    public long unreadNotificationCount(UserPrincipal principal) {
        return notificationRepository.countByRecipientIdAndIsReadFalse(principal.id());
    }

    public void markNotificationRead(UserPrincipal principal, Long notificationId) {
        NotificationItem item = notificationRepository.findByIdAndRecipientId(notificationId, principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Notification not found"));
        item.setRead(true);
        notificationRepository.save(item);
    }

    public SseEmitter streamNotifications(UserPrincipal principal) {
        return notificationStreamService.subscribe(principal.id());
    }

    public PostDtos.CommentResponse addComment(UserPrincipal principal, Long postId, PostDtos.CreateCommentRequest request) {
        rateLimitService.assertAllowed("comment", principal.id(), commentsPerMinute, Duration.ofMinutes(1));

        Long safePostId = Objects.requireNonNull(postId, "Post id is required");
        String content = request.content().trim();
        contentModerationService.assertAllowed(content);

        AppUser me = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));
        Post post = postRepository.findById(safePostId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));

        PostComment comment = new PostComment();
        comment.setPost(post);
        comment.setAuthor(me);
        comment.setContent(content);
        comment.setCreatedAt(Instant.now());
        PostComment saved = postCommentRepository.save(comment);

        post.setReplyCount(post.getReplyCount() + 1);
        Post updatedPost = postRepository.save(post);
        postService.invalidateDashboardCache();
        postService.publishPostEvent("post_updated", updatedPost, null);

        Long authorUserId = post.getAuthorUserId();
        if (authorUserId != null && !authorUserId.equals(me.getId())) {
            appUserRepository.findById(authorUserId).ifPresent(target ->
                    createNotification(target, "comment", me.getDisplayName() + " commented on your post")
            );
        }

        return new PostDtos.CommentResponse(
                saved.getId(),
                safePostId,
                me.getDisplayName(),
                me.getHandle(),
                saved.getContent(),
                saved.getCreatedAt()
        );
    }

    public List<PostDtos.CommentResponse> comments(Long postId) {
        return postCommentRepository.findByPostIdOrderByCreatedAtAsc(postId).stream()
                .map(comment -> new PostDtos.CommentResponse(
                        comment.getId(),
                        postId,
                        comment.getAuthor().getDisplayName(),
                        comment.getAuthor().getHandle(),
                        comment.getContent(),
                        comment.getCreatedAt()
                ))
                .toList();
    }

    void createNotification(AppUser target, String type, String message) {
        NotificationItem item = new NotificationItem();
        item.setRecipient(target);
        item.setType(type);
        item.setMessage(message);
        item.setRead(false);
        item.setCreatedAt(Instant.now());
        NotificationItem saved = notificationRepository.save(item);
        notificationStreamService.publish(target.getId(), toNotificationResponse(saved));
    }

    private PostDtos.NotificationResponse toNotificationResponse(NotificationItem item) {
        return new PostDtos.NotificationResponse(
                item.getId(),
                item.getType(),
                item.getMessage(),
                item.isRead(),
                item.getCreatedAt()
        );
    }
}
