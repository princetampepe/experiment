package com.pulse.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@Transactional
public class PostService {

    private static final Duration DASHBOARD_CACHE_TTL = Duration.ofSeconds(20);

    private final PostRepository repository;
    private final AppUserRepository appUserRepository;
    private final PostCommentRepository postCommentRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationStreamService notificationStreamService;
    private final FollowRepository followRepository;
    private final PostEditHistoryRepository postEditHistoryRepository;
    private final FeedStreamService feedStreamService;
    private final RateLimitService rateLimitService;
    private final ContentModerationService contentModerationService;

    private final int postsPerMinute;
    private final int engagementsPerMinute;
    private final int editsPerMinute;

    private volatile PostDtos.DashboardResponse dashboardCache;
    private volatile Instant dashboardCacheAt = Instant.EPOCH;

    public PostService(
            PostRepository repository,
            AppUserRepository appUserRepository,
            PostCommentRepository postCommentRepository,
            NotificationRepository notificationRepository,
            NotificationStreamService notificationStreamService,
            FollowRepository followRepository,
            PostEditHistoryRepository postEditHistoryRepository,
            FeedStreamService feedStreamService,
            RateLimitService rateLimitService,
            ContentModerationService contentModerationService,
            @Value("${app.rate-limit.posts-per-minute:8}") int postsPerMinute,
            @Value("${app.rate-limit.engagements-per-minute:80}") int engagementsPerMinute,
            @Value("${app.rate-limit.edits-per-minute:12}") int editsPerMinute
    ) {
        this.repository = repository;
        this.appUserRepository = appUserRepository;
        this.postCommentRepository = postCommentRepository;
        this.notificationRepository = notificationRepository;
        this.notificationStreamService = notificationStreamService;
        this.followRepository = followRepository;
        this.postEditHistoryRepository = postEditHistoryRepository;
        this.feedStreamService = feedStreamService;
        this.rateLimitService = rateLimitService;
        this.contentModerationService = contentModerationService;
        this.postsPerMinute = postsPerMinute;
        this.engagementsPerMinute = engagementsPerMinute;
        this.editsPerMinute = editsPerMinute;
    }

    public SseEmitter streamFeed() {
        return feedStreamService.subscribe();
    }

    public List<PostDtos.PostResponse> getPosts(Optional<String> query) {
        List<Post> ranked = rankPosts(repository.findAll(), null, List.of());
        return toResponses(ranked, query.orElse(""), null);
    }

    public PostDtos.PagedPostsResponse getPostsPage(String query, int page, int size) {
        return getPostsPage(query, page, size, null);
    }

    public PostDtos.PagedPostsResponse getPostsPage(String query, int page, int size, Long viewerId) {
        List<Long> followedAuthorIds = viewerId == null
                ? List.of()
                : followRepository.findByFollowerId(viewerId).stream()
                        .map(follow -> follow.getFollowing().getId())
                        .toList();
        return rankAndPage(repository.findAll(), query, page, size, viewerId, followedAuthorIds);
    }

    public PostDtos.PagedPostsResponse rankAndPage(
            List<Post> sourcePosts,
            String query,
            int page,
            int size,
            Long viewerId,
            List<Long> followedAuthorIds
    ) {
        int safePage = Math.max(0, page);
        int safeSize = clampPageSize(size);

        List<Post> ranked = rankPosts(sourcePosts, viewerId, followedAuthorIds);
        List<Post> filtered = ranked.stream()
                .filter(post -> matchesQuery(post, query))
                .toList();

        int start = Math.min(safePage * safeSize, filtered.size());
        int end = Math.min(start + safeSize, filtered.size());
        List<Post> pageItems = new ArrayList<>(filtered.subList(start, end));

        incrementViewCounts(pageItems);

        List<PostDtos.PostResponse> items = pageItems.stream()
                .map(post -> toResponse(post, viewerId))
                .toList();

        return new PostDtos.PagedPostsResponse(
                items,
                safePage,
                safeSize,
                filtered.size(),
                end < filtered.size()
        );
    }

    public List<PostDtos.PostResponse> toResponses(List<Post> posts, String query) {
        return toResponses(posts, query, null);
    }

    public List<PostDtos.PostResponse> toResponses(List<Post> posts, String query, Long viewerId) {
        return posts.stream()
                .filter(post -> matchesQuery(post, query))
                .map(post -> toResponse(post, viewerId))
                .toList();
    }

    public PostDtos.PostResponse createPost(PostDtos.CreatePostRequest request, UserPrincipal principal) {
        rateLimitService.assertAllowed("post", principal.id(), postsPerMinute, Duration.ofMinutes(1));

        String content = request.content().trim();
        contentModerationService.assertAllowed(content);

        AppUser currentUser = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));

        Long parentPostId = request.parentPostId();
        if (parentPostId != null) {
            repository.findById(parentPostId)
                    .orElseThrow(() -> new IllegalArgumentException("Thread parent post not found"));
        }

        List<String> tags = normalizeTags(request.tags());
        List<String> mediaUrls = normalizeMediaUrls(request.mediaUrls());
        List<String> pollOptions = normalizePollOptions(request.pollOptions());

        Post post = new Post();
        post.setAuthor(currentUser.getDisplayName());
        post.setHandle(currentUser.getHandle());
        post.setAuthorUserId(currentUser.getId());
        post.setContent(content);
        post.setTagsCsv(listToCsv(tags));
        post.setMediaUrlsCsv(listToCsv(mediaUrls));
        post.setPollOptionsCsv(listToCsv(pollOptions));
        post.setPollVotesCsv(encodePollVotes(pollOptions.stream().collect(Collectors.toMap(option -> option, ignored -> 0L, (left, right) -> right, LinkedHashMap::new))));
        post.setPollVoterUserIdsCsv("");
        post.setParentPostId(parentPostId);
        post.setReplyCount(0);
        post.setRepostCount(0);
        post.setLikeCount(0);
        post.setBookmarkCount(0);
        post.setCreatedAt(Instant.now());
        post.setEditedAt(null);
        post.setViewCount(0);

        Post saved = repository.save(post);
        invalidateDashboardCache();
        publishPostEvent("post_created", saved, null);
        return toResponse(saved, principal.id());
    }

    public PostDtos.PostResponse engage(long postId, String action, UserPrincipal principal) {
        rateLimitService.assertAllowed("engage", principal.id(), engagementsPerMinute, Duration.ofMinutes(1));

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

        invalidateDashboardCache();
        publishPostEvent("post_updated", saved, null);
        return toResponse(saved, principal.id());
    }

    public PostDtos.PostResponse editPost(long postId, PostDtos.EditPostRequest request, UserPrincipal principal) {
        rateLimitService.assertAllowed("edit", principal.id(), editsPerMinute, Duration.ofMinutes(1));

        Post post = repository.findById(postId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));

        if (post.getAuthorUserId() == null || !post.getAuthorUserId().equals(principal.id())) {
            throw new IllegalArgumentException("Only the post author can edit this post");
        }

        String content = request.content().trim();
        contentModerationService.assertAllowed(content);
        if (content.equals(post.getContent())) {
            return toResponse(post, principal.id());
        }

        PostEditHistory history = new PostEditHistory();
        history.setPost(post);
        history.setPreviousContent(post.getContent());
        history.setEditedAt(Instant.now());
        postEditHistoryRepository.save(history);

        post.setContent(content);
        post.setEditedAt(Instant.now());

        Post saved = repository.save(post);
        invalidateDashboardCache();
        publishPostEvent("post_updated", saved, null);
        return toResponse(saved, principal.id());
    }

    public PostDtos.PostResponse voteOnPoll(long postId, PostDtos.VotePollRequest request, UserPrincipal principal) {
        rateLimitService.assertAllowed("poll-vote", principal.id(), engagementsPerMinute, Duration.ofMinutes(1));

        Post post = repository.findById(postId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));

        List<String> pollOptions = csvToList(post.getPollOptionsCsv());
        if (pollOptions.isEmpty()) {
            throw new IllegalArgumentException("This post does not have an active poll");
        }

        String selectedOption = request.option().trim();
        String canonicalOption = pollOptions.stream()
                .filter(option -> option.equalsIgnoreCase(selectedOption))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Invalid poll option"));

        Set<Long> voterIds = csvToLongSet(post.getPollVoterUserIdsCsv());
        if (voterIds.contains(principal.id())) {
            throw new IllegalArgumentException("You already voted in this poll");
        }

        Map<String, Long> pollVotes = decodePollVotes(post.getPollVotesCsv(), pollOptions);
        pollVotes.put(canonicalOption, pollVotes.getOrDefault(canonicalOption, 0L) + 1);

        voterIds.add(principal.id());
        post.setPollVotesCsv(encodePollVotes(pollVotes));
        post.setPollVoterUserIdsCsv(voterIds.stream().map(String::valueOf).collect(Collectors.joining(",")));

        Post saved = repository.save(post);
        invalidateDashboardCache();
        publishPostEvent("post_updated", saved, null);
        return toResponse(saved, principal.id());
    }

    public PostDtos.PostInsightsResponse getPostInsights(long postId) {
        Post post = repository.findById(postId)
                .orElseThrow(() -> new IllegalArgumentException("Post not found"));
        int commentCount = Math.toIntExact(postCommentRepository.countByPostId(post.getId()));
        return buildInsights(post, commentCount);
    }

    public void invalidateDashboardCache() {
        dashboardCache = null;
        dashboardCacheAt = Instant.EPOCH;
    }

    public void publishPostEvent(String eventType, Post post, Long viewerId) {
        feedStreamService.publish(new PostDtos.FeedEventResponse(
                eventType,
                post.getId(),
                toResponse(post, viewerId),
                Instant.now()
        ));
    }

    public PostDtos.PostResponse toResponseForViewer(Post post, Long viewerId) {
        return toResponse(post, viewerId);
    }

    public PostDtos.DashboardResponse getDashboard() {
        Instant now = Instant.now();
        PostDtos.DashboardResponse cached = dashboardCache;
        if (cached != null && dashboardCacheAt.plus(DASHBOARD_CACHE_TTL).isAfter(now)) {
            return cached;
        }

        List<Post> posts = repository.findAll();
        long totalPosts = posts.size();
        long totalLikes = posts.stream().mapToLong(Post::getLikeCount).sum();
        long totalReposts = posts.stream().mapToLong(Post::getRepostCount).sum();
        long totalReplies = posts.stream().mapToLong(Post::getReplyCount).sum();
        long totalBookmarks = posts.stream().mapToLong(Post::getBookmarkCount).sum();

        long totalEngagement = totalLikes + totalReposts + totalReplies + totalBookmarks;
        long averageLikes = totalPosts == 0 ? 0 : Math.round((double) totalLikes / totalPosts);

        PostDtos.DashboardResponse computed = new PostDtos.DashboardResponse(
                totalPosts,
                totalEngagement,
                averageLikes,
                totalBookmarks,
                buildTrends(posts),
                buildWeeklyActivity(posts),
                analyzeMissingFunctionalities()
        );

        dashboardCache = computed;
        dashboardCacheAt = now;
        return computed;
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

    private List<Post> rankPosts(List<Post> posts, Long viewerId, List<Long> followedAuthorIds) {
        Instant now = Instant.now();
        Set<Long> followedSet = new LinkedHashSet<>(followedAuthorIds);

        return posts.stream()
                .sorted(Comparator.comparingDouble((Post post) -> scorePost(post, viewerId, followedSet, now)).reversed())
                .toList();
    }

    private double scorePost(Post post, Long viewerId, Set<Long> followedSet, Instant now) {
        double ageHours = Math.max(0.25d, Duration.between(post.getCreatedAt(), now).toMinutes() / 60.0d);
        double freshness = 58.0d / (2.0d + ageHours);
        double engagement = (post.getLikeCount() * 3.0d)
                + (post.getRepostCount() * 3.6d)
                + (post.getReplyCount() * 2.3d)
                + (post.getBookmarkCount() * 1.9d);
        double relationshipBoost = 0.0d;

        if (viewerId != null && post.getAuthorUserId() != null) {
            if (post.getAuthorUserId().equals(viewerId)) {
                relationshipBoost = 9.0d;
            } else if (followedSet.contains(post.getAuthorUserId())) {
                relationshipBoost = 6.5d;
            }
        }

        double mediaBoost = csvToList(post.getMediaUrlsCsv()).isEmpty() ? 0.0d : 1.2d;
        double pollBoost = csvToList(post.getPollOptionsCsv()).isEmpty() ? 0.0d : 0.8d;
        double deterministicNoise = (post.getId() == null ? 0L : post.getId() % 11L) / 100.0d;

        return freshness + engagement + relationshipBoost + mediaBoost + pollBoost + deterministicNoise;
    }

    private void incrementViewCounts(List<Post> posts) {
        if (posts.isEmpty()) {
            return;
        }

        for (Post post : posts) {
            post.setViewCount(post.getViewCount() + 1);
        }
        repository.saveAll(posts);
    }

    private boolean matchesQuery(Post post, String query) {
        if (query == null || query.isBlank()) {
            return true;
        }

        String q = query.trim().toLowerCase(Locale.ROOT);
        String aggregate = String.join(" ",
                safeValue(post.getAuthor()),
                safeValue(post.getHandle()),
                safeValue(post.getContent()),
                safeValue(post.getTagsCsv()),
                safeValue(post.getMediaUrlsCsv()),
                safeValue(post.getPollOptionsCsv())
        ).toLowerCase(Locale.ROOT);
        return aggregate.contains(q);
    }

    private String safeValue(String value) {
        return value == null ? "" : value;
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
            clean = clean.toLowerCase(Locale.ROOT);
            if (!normalized.contains(clean)) {
                normalized.add(clean);
            }
            if (normalized.size() == 6) {
                break;
            }
        }

        return normalized.isEmpty() ? List.of("#update") : normalized;
    }

    private List<String> normalizeMediaUrls(List<String> mediaUrls) {
        if (mediaUrls == null || mediaUrls.isEmpty()) {
            return List.of();
        }

        List<String> normalized = new ArrayList<>();
        for (String mediaUrl : mediaUrls) {
            if (mediaUrl == null || mediaUrl.isBlank()) {
                continue;
            }
            String trimmed = mediaUrl.trim();
            if (!(trimmed.startsWith("https://") || trimmed.startsWith("http://"))) {
                continue;
            }
            if (!normalized.contains(trimmed)) {
                normalized.add(trimmed);
            }
            if (normalized.size() == 4) {
                break;
            }
        }

        return normalized;
    }

    private List<String> normalizePollOptions(List<String> pollOptions) {
        if (pollOptions == null || pollOptions.isEmpty()) {
            return List.of();
        }

        List<String> options = new ArrayList<>();
        for (String option : pollOptions) {
            if (option == null || option.isBlank()) {
                continue;
            }
            String clean = option.trim()
                    .replace("|", "")
                    .replace("::", "")
                    .replace(",", "");
            if (clean.length() > 80) {
                clean = clean.substring(0, 80);
            }
            String normalizedOption = clean;
            if (!normalizedOption.isBlank() && options.stream().noneMatch(existing -> existing.equalsIgnoreCase(normalizedOption))) {
                options.add(normalizedOption);
            }
            if (options.size() == 4) {
                break;
            }
        }

        if (options.size() == 1) {
            throw new IllegalArgumentException("Poll requires at least 2 options");
        }

        return options;
    }

    private int clampPageSize(int size) {
        if (size < 1) {
            return 10;
        }
        return Math.min(size, 50);
    }

    private String listToCsv(List<String> values) {
        return values == null || values.isEmpty() ? "" : String.join(",", values);
    }

    private List<String> csvToList(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .toList();
    }

    private Map<String, Long> decodePollVotes(String encodedVotes, List<String> options) {
        Map<String, Long> votes = new LinkedHashMap<>();
        for (String option : options) {
            votes.put(option, 0L);
        }

        if (encodedVotes == null || encodedVotes.isBlank()) {
            return votes;
        }

        String[] pairs = encodedVotes.split("\\|");
        for (String pair : pairs) {
            if (pair.isBlank() || !pair.contains("::")) {
                continue;
            }
            String[] parts = pair.split("::", 2);
            if (parts.length < 2) {
                continue;
            }
            String encodedOption = parts[0].trim();
            long count;
            try {
                count = Math.max(0L, Long.parseLong(parts[1].trim()));
            } catch (NumberFormatException exception) {
                continue;
            }

            String option = options.stream()
                    .filter(existing -> existing.equalsIgnoreCase(encodedOption))
                    .findFirst()
                    .orElse(null);
            if (option != null) {
                votes.put(option, count);
            }
        }

        return votes;
    }

    private String encodePollVotes(Map<String, Long> votes) {
        if (votes.isEmpty()) {
            return "";
        }

        return votes.entrySet().stream()
                .map(entry -> sanitizeToken(entry.getKey()) + "::" + Math.max(0L, entry.getValue()))
                .collect(Collectors.joining("|"));
    }

    private String sanitizeToken(String value) {
        return value.replace("|", "").replace("::", "").replace(",", "").trim();
    }

    private Set<Long> csvToLongSet(String csv) {
        if (csv == null || csv.isBlank()) {
            return new LinkedHashSet<>();
        }

        Set<Long> values = new LinkedHashSet<>();
        for (String token : csv.split(",")) {
            if (token.isBlank()) {
                continue;
            }
            try {
                values.add(Long.parseLong(token.trim()));
            } catch (NumberFormatException ignored) {
                // Ignore malformed ids.
            }
        }
        return values;
    }

    private PostDtos.PostResponse toResponse(Post post, Long viewerId) {
        int commentCount = Math.toIntExact(postCommentRepository.countByPostId(post.getId()));
        PostDtos.PostPollResponse poll = buildPollResponse(post, viewerId);

        return new PostDtos.PostResponse(
                post.getId(),
                post.getAuthor(),
                post.getHandle(),
                post.getContent(),
                csvToList(post.getTagsCsv()).isEmpty() ? List.of("#update") : csvToList(post.getTagsCsv()),
                csvToList(post.getMediaUrlsCsv()),
                poll,
                post.getParentPostId(),
                post.getReplyCount(),
                post.getRepostCount(),
                post.getLikeCount(),
                post.getBookmarkCount(),
                commentCount,
                post.getCreatedAt(),
                post.getEditedAt(),
                post.getViewCount(),
                buildInsights(post, commentCount)
        );
    }

    private PostDtos.PostPollResponse buildPollResponse(Post post, Long viewerId) {
        List<String> options = csvToList(post.getPollOptionsCsv());
        if (options.isEmpty()) {
            return null;
        }

        Map<String, Long> pollVotes = decodePollVotes(post.getPollVotesCsv(), options);
        long totalVotes = pollVotes.values().stream().mapToLong(Long::longValue).sum();
        Set<Long> voterIds = csvToLongSet(post.getPollVoterUserIdsCsv());

        List<PostDtos.PollOptionResponse> pollOptions = options.stream()
                .map(option -> {
                    long votes = pollVotes.getOrDefault(option, 0L);
                    double percentage = totalVotes == 0 ? 0.0d : round((votes * 100.0d) / totalVotes, 1);
                    return new PostDtos.PollOptionResponse(option, votes, percentage);
                })
                .toList();

        boolean hasVoted = viewerId != null && voterIds.contains(viewerId);
        return new PostDtos.PostPollResponse(pollOptions, totalVotes, hasVoted);
    }

    private PostDtos.PostInsightsResponse buildInsights(Post post, int commentCount) {
        long views = post.getViewCount();
        long engagementTotal = post.getLikeCount() + post.getRepostCount() + post.getReplyCount() + post.getBookmarkCount() + commentCount;
        double engagementRate = views == 0
                ? (engagementTotal == 0 ? 0.0d : 100.0d)
                : round((engagementTotal * 100.0d) / views, 2);
        return new PostDtos.PostInsightsResponse(views, engagementTotal, engagementRate);
    }

    private double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }

    private List<PostDtos.TrendResponse> buildTrends(List<Post> posts) {
        Map<String, Long> trendScore = new LinkedHashMap<>();
        for (Post post : posts) {
            long score = post.getLikeCount() + post.getRepostCount() + post.getBookmarkCount();
            for (String tag : csvToList(post.getTagsCsv())) {
                trendScore.put(tag, trendScore.getOrDefault(tag, 0L) + score);
            }
        }

        return trendScore.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(8)
                .map(entry -> new PostDtos.TrendResponse(entry.getKey(), entry.getValue()))
                .toList();
    }

    private List<Integer> buildWeeklyActivity(List<Post> posts) {
        List<Integer> baseline = new ArrayList<>(List.of(43, 55, 49, 62, 71, 66, 58));
        int bump = Math.min(26, posts.size() * 2);
        baseline.set(6, Math.min(100, baseline.get(6) + bump));
        return baseline;
    }

    private List<PostDtos.GapItem> analyzeMissingFunctionalities() {
        return List.of(
                new PostDtos.GapItem(
                        "DM Inbox",
                        "Private messaging remains a core retention feature for social products.",
                        "Add conversation threads, read receipts, and attachment support."
                ),
                new PostDtos.GapItem(
                        "Moderator Review Queue",
                        "Blocked content should be reviewable with restore and appeal workflows.",
                        "Create a moderation dashboard with triage and decision audit logs."
                ),
                new PostDtos.GapItem(
                        "Media CDN Storage",
                        "Direct URL media is fine for demo mode but not for production reliability.",
                        "Upload files to object storage and serve via CDN with signed URLs."
                )
        );
    }
}
