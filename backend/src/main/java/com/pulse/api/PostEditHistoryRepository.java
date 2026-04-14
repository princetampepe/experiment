package com.pulse.api;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PostEditHistoryRepository extends JpaRepository<PostEditHistory, Long> {
    List<PostEditHistory> findTop10ByPostIdOrderByEditedAtDesc(Long postId);
}
