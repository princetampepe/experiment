package com.pulse.api;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DirectMessageRepository extends JpaRepository<DirectMessage, Long> {
    List<DirectMessage> findBySenderIdOrRecipientIdOrderByCreatedAtDesc(Long senderId, Long recipientId);

    List<DirectMessage> findBySenderIdAndRecipientIdOrSenderIdAndRecipientIdOrderByCreatedAtDesc(
            Long senderA,
            Long recipientA,
            Long senderB,
            Long recipientB,
            Pageable pageable
    );

    List<DirectMessage> findBySenderIdAndRecipientIdAndReadAtIsNull(Long senderId, Long recipientId);

    long countBySenderIdAndRecipientIdAndReadAtIsNull(Long senderId, Long recipientId);
}
