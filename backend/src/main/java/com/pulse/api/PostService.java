package com.pulse.api;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
@Transactional
public class PostService {

    private final PostRepository repository;
    private final AppUserRepository appUserRepository;
    private final PostCommentRepository postCommentRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationStreamService notificationStreamService;

    public PostService(
            PostRepository repository,
            AppUserRepository appUserRepository,
            PostCommentRepository postCommentRepository,
            NotificationRepository notificationRepository,
            NotificationStreamService notificationStreamService
    ) {
        this.repository = repository;
        this.appUserRepository = appUserRepository;
        this.postCommentRepository = postCommentRepository;
        this.notificationRepository = notificationRepository;
        this.notificationStreamService = notificationStreamService;
    }

    public List<PostDtos.PostResponse> getPosts(Optional<String> query) {
        List<Post> posts = repository.findAll();
        posts.sort(Comparator.comparing(Post::getCreatedAt).reversed());
        return toResponses(posts, query.orElse(""));
    }

    public PostDtos.PagedPostsResponse getPostsPage(String query, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), clampPageSize(size));
        Page<Post> resultPage = repository.findAllByOrderByCreatedAtDesc(pageable);
        List<PostDtos.PostResponse> filtered = toResponses(resultPage.getContent(), query);
        return new PostDtos.PagedPostsResponse(
                filtered,
                resultPage.getNumber(),
                resultPage.getSize(),
                resultPage.getTotalElements(),
                resultPage.hasNext()
        );
    }

    public List<PostDtos.PostResponse> toResponses(List<Post> posts, String query) {
        Optional<String> optionalQuery = Optional.ofNullable(query);
        return posts.stream()
                .filter(post -> matchesQuery(post, optionalQuery))
                .map(this::toResponse)
                .toList();
    }

    public PostDtos.PostResponse createPost(PostDtos.CreatePostRequest request, UserPrincipal principal) {
        AppUser currentUser = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));

        Post post = new Post();
        post.setAuthor(currentUser.getDisplayName());
        post.setHandle(currentUser.getHandle());
        post.setAuthorUserId(currentUser.getId());
        post.setContent(request.content().trim());
        post.setTagsCsv(tagsToCsv(normalizeTags(request.tags())));
        post.setReplyCount(0);
        post.setRepostCount(0);
        post.setLikeCount(0);
        post.setBookmarkCount(0);
        post.setCreatedAt(Instant.now());

        return toResponse(repository.save(post));
    }

    public PostDtos.PostResponse engage(long postId, String action, UserPrincipal principal) {
        Post post = repository.findById(postId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));

        String normalizedAction = action.toLowerCase(Locale.ROOT);
        boolean notifyAuthor = false;

        switch (normalizedAction) {
            case "reply" -> {
                post.setReplyCount(post.getReplyCount() + 1);
                notifyAuthor = true;
            }
            case "repost" -> {
                if (post.getRepostedUserIds().add(principal.id())) {
                    post.setRepostCount(post.getRepostCount() + 1);
                    notifyAuthor = true;
                }
            }
            case "like" -> {
                if (post.getLikedUserIds().add(principal.id())) {
                    post.setLikeCount(post.getLikeCount() + 1);
                    notifyAuthor = true;
                }
            }
            case "bookmark" -> {
                post.setBookmarkCount(post.getBookmarkCount() + 1);
                notifyAuthor = true;
            }
            default -> throw new IllegalArgumentException("Unsupported action: " + action);
        }

        Post saved = repository.save(post);
        Long authorUserId = saved.getAuthorUserId();
        if (notifyAuthor && authorUserId != null && !authorUserId.equals(principal.id())) {
            appUserRepository.findById(authorUserId).ifPresent(target ->
                    createNotification(target, normalizedAction, principal.displayName() + " engaged with your post")
            );
        }
        return toResponse(saved);
    }

    private void createNotification(AppUser target, String type, String message) {
        NotificationItem item = new NotificationItem();
        item.setRecipient(target);
        item.setType(type);
        item.setMessage(message);
        item.setRead(false);
        item.setCreatedAt(Instant.now());
        NotificationItem saved = notificationRepository.save(item);
        notificationStreamService.publish(target.getId(), new PostDtos.NotificationResponse(
                saved.getId(),
                saved.getType(),
                saved.getMessage(),
                saved.isRead(),
                saved.getCreatedAt()
        ));
    }

    public PostDtos.DashboardResponse getDashboard() {
        List<Post> posts = repository.findAll();
        long totalPosts = posts.size();
        long totalLikes = posts.stream().mapToLong(Post::getLikeCount).sum();
        long totalReposts = posts.stream().mapToLong(Post::getRepostCount).sum();
        long totalReplies = posts.stream().mapToLong(Post::getReplyCount).sum();
        long totalBookmarks = posts.stream().mapToLong(Post::getBookmarkCount).sum();

        long totalEngagement = totalLikes + totalReposts + totalReplies + totalBookmarks;
        long averageLikes = totalPosts == 0 ? 0 : Math.round((double) totalLikes / totalPosts);

        return new PostDtos.DashboardResponse(
                totalPosts,
                totalEngagement,
                averageLikes,
                totalBookmarks,
                buildTrends(posts),
                buildWeeklyActivity(posts),
                analyzeMissingFunctionalities()
        );
    }

    private boolean matchesQuery(Post post, Optional<String> query) {
        if (query.isEmpty() || query.get().isBlank()) {
            return true;
        }

        String q = query.get().trim().toLowerCase(Locale.ROOT);
        String aggregate = String.join(" ",
                post.getAuthor(),
                post.getHandle(),
                post.getContent(),
                post.getTagsCsv()
        ).toLowerCase(Locale.ROOT);
        return aggregate.contains(q);
    }

    private List<String> normalizeTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return List.of("#update");
        }

        List<String> normalized = new ArrayList<>();
        for (String tag : tags) {
            if (tag == null || tag.isBlank()) {
                continue;
            }
            String clean = tag.trim();
            if (!clean.startsWith("#")) {
                clean = "#" + clean;
            }
            normalized.add(clean.toLowerCase(Locale.ROOT));
            if (normalized.size() == 4) {
                break;
            }
        }

        if (normalized.isEmpty()) {
            return List.of("#update");
        }
        return normalized;
    }

    private int clampPageSize(int size) {
        if (size < 1) {
            return 10;
        }
        return Math.min(size, 50);
    }

    private String tagsToCsv(List<String> tags) {
        return String.join(",", tags);
    }

    private List<String> csvToTags(String tagsCsv) {
        if (tagsCsv == null || tagsCsv.isBlank()) {
            return List.of("#update");
        }

        return Arrays.stream(tagsCsv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    private List<PostDtos.TrendResponse> buildTrends(List<Post> posts) {
        Map<String, Long> trendScore = new LinkedHashMap<>();
        for (Post post : posts) {
            long score = post.getLikeCount() + post.getRepostCount() + post.getBookmarkCount();
            for (String tag : csvToTags(post.getTagsCsv())) {
                trendScore.put(tag, trendScore.getOrDefault(tag, 0L) + score);
            }
        }

        return trendScore.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(6)
                .map(entry -> new PostDtos.TrendResponse(entry.getKey(), entry.getValue()))
                .collect(Collectors.toList());
    }

    private List<Integer> buildWeeklyActivity(List<Post> posts) {
        List<Integer> baseline = new ArrayList<>(List.of(45, 52, 38, 60, 66, 58, 49));
        int bump = Math.min(24, posts.size() * 2);
        baseline.set(6, Math.min(100, baseline.get(6) + bump));
        return baseline;
    }

    private List<PostDtos.GapItem> analyzeMissingFunctionalities() {
        return List.of(
                new PostDtos.GapItem(
                        "Authentication",
                        "Without identity, likes and posts cannot be tied to real users or protected.",
                        "Add JWT auth with role-based access and refresh tokens."
                ),
                new PostDtos.GapItem(
                        "Follow Graph",
                        "Personalized timelines require follower/following relationships.",
                        "Add user, follow, and block tables with timeline query strategies."
                ),
                new PostDtos.GapItem(
                        "Notifications",
                        "Users need feedback for replies, mentions, and reposts.",
                        "Create notification entities and stream updates via WebSocket."
                ),
                new PostDtos.GapItem(
                        "Media Uploads",
                        "Text-only posting limits engagement and creator workflows.",
                        "Store media metadata in DB and files in local object storage."
                ),
                new PostDtos.GapItem(
                        "Moderation and Reports",
                        "A social platform needs abuse handling and content controls.",
                        "Implement report queues, status workflow, and basic text moderation."
                )
        );
    }

    private PostDtos.PostResponse toResponse(Post post) {
        int commentCount = Math.toIntExact(postCommentRepository.countByPostId(post.getId()));
        return new PostDtos.PostResponse(
                post.getId(),
                post.getAuthor(),
                post.getHandle(),
                post.getContent(),
                csvToTags(post.getTagsCsv()),
                post.getReplyCount(),
                post.getRepostCount(),
                post.getLikeCount(),
                post.getBookmarkCount(),
            commentCount,
                post.getCreatedAt()
        );
    }
}
