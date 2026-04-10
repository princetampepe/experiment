package com.pulse.api;

import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Configuration
public class SeedDataConfig {

    @Bean
    CommandLineRunner seedPosts(
            PostRepository repository,
            AppUserRepository appUserRepository,
            FollowRepository followRepository,
            PasswordEncoder passwordEncoder
    ) {
        return args -> {
            if (repository.count() > 0 || appUserRepository.count() > 0) {
                return;
            }

            AppUser avery = createUser(appUserRepository, passwordEncoder, "avery@pulse.dev", "@averystone", "Avery Stone");
            AppUser maya = createUser(appUserRepository, passwordEncoder, "maya@pulse.dev", "@mayaops", "Maya Lin");
            AppUser noah = createUser(appUserRepository, passwordEncoder, "noah@pulse.dev", "@noahcreates", "Noah Park");

            createFollow(followRepository, maya, avery);
            createFollow(followRepository, noah, maya);

            repository.save(buildPost(
                    "Avery Stone",
                    "@averystone",
                    avery.getId(),
                    "Rolling out our instant feedback loop. The team shipped from idea to prototype in 48 hours.",
                    "#buildinpublic,#product",
                    4, 9, 27, 6,
                    Instant.now().minus(2, ChronoUnit.MINUTES)
            ));

            repository.save(buildPost(
                    "Maya Lin",
                    "@mayaops",
                    maya.getId(),
                    "Small dashboards beat giant reports. If you cannot decide in 30 seconds, it needs less noise.",
                    "#analytics,#ux",
                    7, 15, 39, 11,
                    Instant.now().minus(30, ChronoUnit.MINUTES)
            ));

            repository.save(buildPost(
                    "Noah Park",
                    "@noahcreates",
                    noah.getId(),
                    "Just tested a calmer notification design. Attention is a design material, not free inventory.",
                    "#design,#frontend",
                    2, 5, 20, 4,
                    Instant.now().minus(1, ChronoUnit.HOURS)
            ));
        };
    }

    private @NonNull AppUser createUser(
            AppUserRepository repository,
            PasswordEncoder passwordEncoder,
            String email,
            String handle,
            String displayName
    ) {
        AppUser user = new AppUser();
        user.setEmail(email);
        user.setHandle(handle);
        user.setDisplayName(displayName);
        user.setPasswordHash(passwordEncoder.encode("password123"));
        user.setBio("Designing better social experiences.");
        user.setCreatedAt(Instant.now().minus(2, ChronoUnit.DAYS));
        return repository.save(user);
    }

    private void createFollow(FollowRepository repository, AppUser follower, AppUser following) {
        Follow follow = new Follow();
        follow.setFollower(follower);
        follow.setFollowing(following);
        follow.setCreatedAt(Instant.now().minus(1, ChronoUnit.DAYS));
        repository.save(follow);
    }

    private @NonNull Post buildPost(
            String author,
            String handle,
            Long authorUserId,
            String content,
            String tagsCsv,
            int reply,
            int repost,
            int like,
            int bookmark,
            Instant createdAt
    ) {
        Post post = new Post();
        post.setAuthor(author);
        post.setHandle(handle);
        post.setAuthorUserId(authorUserId);
        post.setContent(content);
        post.setTagsCsv(tagsCsv);
        post.setReplyCount(reply);
        post.setRepostCount(repost);
        post.setLikeCount(like);
        post.setBookmarkCount(bookmark);
        post.setCreatedAt(createdAt);
        return post;
    }
}
