package com.pulse.api;

import jakarta.persistence.Column;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Entity;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "posts")
public class Post {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String author;

    @Column(nullable = false, length = 40)
    private String handle;

    @Column
    private Long authorUserId;

    @Column(nullable = false, length = 280)
    private String content;

    @Column(nullable = false, length = 255)
    private String tagsCsv;

    @Column(length = 1200)
    private String mediaUrlsCsv;

    @Column(length = 600)
    private String pollOptionsCsv;

    @Column(length = 1200)
    private String pollVotesCsv;

    @Column(length = 1200)
    private String pollVoterUserIdsCsv;

    @Column
    private Long parentPostId;

    @Column(nullable = false)
    private int replyCount;

    @Column(nullable = false)
    private int repostCount;

    @Column(nullable = false)
    private int likeCount;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(
            name = "post_like_users",
            joinColumns = @JoinColumn(name = "post_id"),
            uniqueConstraints = @UniqueConstraint(columnNames = {"post_id", "user_id"})
    )
    @Column(name = "user_id", nullable = false)
    private Set<Long> likedUserIds = new HashSet<>();

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(
            name = "post_repost_users",
            joinColumns = @JoinColumn(name = "post_id"),
            uniqueConstraints = @UniqueConstraint(columnNames = {"post_id", "user_id"})
    )
    @Column(name = "user_id", nullable = false)
    private Set<Long> repostedUserIds = new HashSet<>();

    @Column(nullable = false)
    private int bookmarkCount;

    @Column(nullable = false)
    private Instant createdAt;

    @Column
    private Instant editedAt;

    @Column
    private Long viewCount;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getAuthor() {
        return author;
    }

    public void setAuthor(String author) {
        this.author = author;
    }

    public String getHandle() {
        return handle;
    }

    public void setHandle(String handle) {
        this.handle = handle;
    }

    public Long getAuthorUserId() {
        return authorUserId;
    }

    public void setAuthorUserId(Long authorUserId) {
        this.authorUserId = authorUserId;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getTagsCsv() {
        return tagsCsv;
    }

    public void setTagsCsv(String tagsCsv) {
        this.tagsCsv = tagsCsv;
    }

    public String getMediaUrlsCsv() {
        return mediaUrlsCsv;
    }

    public void setMediaUrlsCsv(String mediaUrlsCsv) {
        this.mediaUrlsCsv = mediaUrlsCsv;
    }

    public String getPollOptionsCsv() {
        return pollOptionsCsv;
    }

    public void setPollOptionsCsv(String pollOptionsCsv) {
        this.pollOptionsCsv = pollOptionsCsv;
    }

    public String getPollVotesCsv() {
        return pollVotesCsv;
    }

    public void setPollVotesCsv(String pollVotesCsv) {
        this.pollVotesCsv = pollVotesCsv;
    }

    public String getPollVoterUserIdsCsv() {
        return pollVoterUserIdsCsv;
    }

    public void setPollVoterUserIdsCsv(String pollVoterUserIdsCsv) {
        this.pollVoterUserIdsCsv = pollVoterUserIdsCsv;
    }

    public Long getParentPostId() {
        return parentPostId;
    }

    public void setParentPostId(Long parentPostId) {
        this.parentPostId = parentPostId;
    }

    public int getReplyCount() {
        return replyCount;
    }

    public void setReplyCount(int replyCount) {
        this.replyCount = replyCount;
    }

    public int getRepostCount() {
        return repostCount;
    }

    public void setRepostCount(int repostCount) {
        this.repostCount = repostCount;
    }

    public int getLikeCount() {
        return likeCount;
    }

    public void setLikeCount(int likeCount) {
        this.likeCount = likeCount;
    }

    public Set<Long> getLikedUserIds() {
        return likedUserIds;
    }

    public void setLikedUserIds(Set<Long> likedUserIds) {
        this.likedUserIds = likedUserIds;
    }

    public Set<Long> getRepostedUserIds() {
        return repostedUserIds;
    }

    public void setRepostedUserIds(Set<Long> repostedUserIds) {
        this.repostedUserIds = repostedUserIds;
    }

    public int getBookmarkCount() {
        return bookmarkCount;
    }

    public void setBookmarkCount(int bookmarkCount) {
        this.bookmarkCount = bookmarkCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getEditedAt() {
        return editedAt;
    }

    public void setEditedAt(Instant editedAt) {
        this.editedAt = editedAt;
    }

    public long getViewCount() {
        return viewCount == null ? 0L : viewCount;
    }

    public void setViewCount(long viewCount) {
        this.viewCount = viewCount;
    }
}
