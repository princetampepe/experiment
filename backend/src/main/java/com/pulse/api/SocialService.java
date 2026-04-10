package com.pulse.api;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

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

    public SocialService(
            AppUserRepository appUserRepository,
            FollowRepository followRepository,
            NotificationRepository notificationRepository,
            PostRepository postRepository,
            PostCommentRepository postCommentRepository,
            PostService postService,
            AuthService authService,
            NotificationStreamService notificationStreamService
    ) {
        this.appUserRepository = appUserRepository;
        this.followRepository = followRepository;
        this.notificationRepository = notificationRepository;
        this.postRepository = postRepository;
        this.postCommentRepository = postCommentRepository;
        this.postService = postService;
        this.authService = authService;
                this.notificationStreamService = notificationStreamService;
    }

    public List<PostDtos.UserProfileResponse> suggestedUsers(UserPrincipal principal) {
        List<AppUser> users = appUserRepository.findAll();
        return users.stream()
                .filter(user -> !user.getId().equals(principal.id()))
                .sorted(Comparator.comparing(AppUser::getCreatedAt).reversed())
                .limit(8)
                .map(user -> authService.toProfile(user, principal.id()))
                .toList();
    }

    public PostDtos.UserProfileResponse follow(UserPrincipal principal, Long targetId) {
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

        List<Post> posts = postRepository.findAll().stream()
                .filter(post -> post.getAuthorUserId() != null
                        && (post.getAuthorUserId().equals(principal.id()) || followingIds.contains(post.getAuthorUserId())))
                .sorted(Comparator.comparing(Post::getCreatedAt).reversed())
                .toList();

        return postService.toResponses(posts, query);
    }

        public PostDtos.PagedPostsResponse personalizedFeedPage(UserPrincipal principal, String query, int page, int size) {
                List<Long> authorIds = new ArrayList<>();
                authorIds.add(principal.id());
                authorIds.addAll(followRepository.findByFollowerId(principal.id()).stream()
                                .map(follow -> follow.getFollowing().getId())
                                .toList());

                Pageable pageable = PageRequest.of(Math.max(page, 0), clampPageSize(size));
                Page<Post> resultPage = postRepository.findByAuthorUserIdInOrderByCreatedAtDesc(authorIds, pageable);
                List<PostDtos.PostResponse> filtered = postService.toResponses(resultPage.getContent(), query);

                return new PostDtos.PagedPostsResponse(
                                filtered,
                                resultPage.getNumber(),
                                resultPage.getSize(),
                                resultPage.getTotalElements(),
                                resultPage.hasNext()
                );
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
        Long safePostId = Objects.requireNonNull(postId, "Post id is required");
        AppUser me = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));
        Post post = postRepository.findById(safePostId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));

        PostComment comment = new PostComment();
        comment.setPost(post);
        comment.setAuthor(me);
        comment.setContent(request.content().trim());
        comment.setCreatedAt(Instant.now());
        PostComment saved = postCommentRepository.save(comment);

        post.setReplyCount(post.getReplyCount() + 1);
        postRepository.save(post);

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

        private int clampPageSize(int size) {
                if (size < 1) {
                        return 10;
                }
                return Math.min(size, 50);
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
