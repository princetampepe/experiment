package com.pulse.api;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;

public interface PostRepository extends JpaRepository<Post, Long> {
	Page<Post> findAllByOrderByCreatedAtDesc(Pageable pageable);

	Page<Post> findByAuthorUserIdInOrderByCreatedAtDesc(List<Long> authorUserIds, Pageable pageable);

	List<Post> findByAuthorUserIdIn(List<Long> authorUserIds);
}
