package com.pulse.api;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;

public interface NotificationRepository extends JpaRepository<NotificationItem, Long> {
    List<NotificationItem> findTop20ByRecipientIdOrderByCreatedAtDesc(Long recipientId);

    Page<NotificationItem> findByRecipientIdOrderByCreatedAtDesc(Long recipientId, Pageable pageable);

    long countByRecipientIdAndIsReadFalse(Long recipientId);

    Optional<NotificationItem> findByIdAndRecipientId(Long id, Long recipientId);
}
