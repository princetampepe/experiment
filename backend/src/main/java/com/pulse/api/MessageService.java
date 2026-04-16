package com.pulse.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@Transactional
public class MessageService {

    private static final int DEFAULT_THREAD_LIMIT = 60;

    private final AppUserRepository appUserRepository;
    private final DirectMessageRepository directMessageRepository;
    private final NotificationRepository notificationRepository;
    private final NotificationStreamService notificationStreamService;
    private final RateLimitService rateLimitService;
    private final ContentModerationService contentModerationService;

    private final int messagesPerMinute;

    public MessageService(
            AppUserRepository appUserRepository,
            DirectMessageRepository directMessageRepository,
            NotificationRepository notificationRepository,
            NotificationStreamService notificationStreamService,
            RateLimitService rateLimitService,
            ContentModerationService contentModerationService,
            @Value("${app.rate-limit.messages-per-minute:35}") int messagesPerMinute
    ) {
        this.appUserRepository = appUserRepository;
        this.directMessageRepository = directMessageRepository;
        this.notificationRepository = notificationRepository;
        this.notificationStreamService = notificationStreamService;
        this.rateLimitService = rateLimitService;
        this.contentModerationService = contentModerationService;
        this.messagesPerMinute = messagesPerMinute;
    }

    public List<PostDtos.ConversationSummaryResponse> inbox(UserPrincipal principal) {
        List<DirectMessage> messages = directMessageRepository
                .findBySenderIdOrRecipientIdOrderByCreatedAtDesc(principal.id(), principal.id());

        Map<Long, DirectMessage> latestByPeer = new LinkedHashMap<>();
        for (DirectMessage message : messages) {
            Long peerId = resolvePeerId(message, principal.id());
            if (peerId == null || latestByPeer.containsKey(peerId)) {
                continue;
            }
            latestByPeer.put(peerId, message);
        }

        List<PostDtos.ConversationSummaryResponse> response = new ArrayList<>();
        for (Map.Entry<Long, DirectMessage> entry : latestByPeer.entrySet()) {
            Long peerId = entry.getKey();
            DirectMessage latest = entry.getValue();
            AppUser peer = resolvePeer(latest, principal.id());
            long unreadCount = directMessageRepository.countBySenderIdAndRecipientIdAndReadAtIsNull(peerId, principal.id());

            response.add(new PostDtos.ConversationSummaryResponse(
                    peerId,
                    peer.getHandle(),
                    peer.getDisplayName(),
                    peer.getBio(),
                    latest.getContent(),
                    latest.getCreatedAt(),
                    unreadCount
            ));
        }

        return response;
    }

    public List<PostDtos.MessageResponse> thread(UserPrincipal principal, Long peerId) {
        Long safePeerId = Objects.requireNonNull(normalizePeer(principal, peerId));
        appUserRepository.findById(safePeerId)
                .orElseThrow(() -> new IllegalArgumentException("Conversation peer not found"));

        List<DirectMessage> messages = directMessageRepository
                .findBySenderIdAndRecipientIdOrSenderIdAndRecipientIdOrderByCreatedAtDesc(
                        principal.id(),
                        safePeerId,
                        safePeerId,
                        principal.id(),
                        PageRequest.of(0, DEFAULT_THREAD_LIMIT)
                );

        messages = messages.stream()
                .sorted(Comparator.comparing(DirectMessage::getCreatedAt))
                .toList();

        return messages.stream()
                .map(message -> toResponse(message, principal.id()))
                .toList();
    }

    public PostDtos.MessageResponse send(UserPrincipal principal, PostDtos.SendMessageRequest request) {
        Long safeRecipientId = Objects.requireNonNull(normalizePeer(principal, request.recipientId()));

        rateLimitService.assertAllowed("messages", principal.id(), messagesPerMinute, Duration.ofMinutes(1));

        String content = request.content().trim();
        contentModerationService.assertAllowed(content);

        AppUser sender = appUserRepository.findById(principal.id())
                .orElseThrow(() -> new IllegalArgumentException("Current user not found"));
        AppUser recipient = appUserRepository.findById(safeRecipientId)
                .orElseThrow(() -> new IllegalArgumentException("Recipient not found"));

        DirectMessage message = new DirectMessage();
        message.setSender(sender);
        message.setRecipient(recipient);
        message.setContent(content);
        message.setCreatedAt(Instant.now());
        message.setReadAt(null);

        DirectMessage saved = directMessageRepository.save(message);
        createMessageNotification(sender, recipient);

        return toResponse(saved, principal.id());
    }

    public void markThreadRead(UserPrincipal principal, Long peerId) {
        Long safePeerId = normalizePeer(principal, peerId);

        List<DirectMessage> unread = directMessageRepository
                .findBySenderIdAndRecipientIdAndReadAtIsNull(safePeerId, principal.id());

        if (unread.isEmpty()) {
            return;
        }

        Instant now = Instant.now();
        unread.forEach(message -> message.setReadAt(now));
        directMessageRepository.saveAll(unread);
    }

    private Long normalizePeer(UserPrincipal principal, Long peerId) {
        if (peerId == null) {
            throw new IllegalArgumentException("Conversation peer id is required");
        }
        if (peerId.equals(principal.id())) {
            throw new IllegalArgumentException("You cannot message yourself");
        }
        return peerId;
    }

    private Long resolvePeerId(DirectMessage message, Long currentUserId) {
        if (message.getSender().getId().equals(currentUserId)) {
            return message.getRecipient().getId();
        }
        if (message.getRecipient().getId().equals(currentUserId)) {
            return message.getSender().getId();
        }
        return null;
    }

    private AppUser resolvePeer(DirectMessage message, Long currentUserId) {
        if (message.getSender().getId().equals(currentUserId)) {
            return message.getRecipient();
        }
        return message.getSender();
    }

    private PostDtos.MessageResponse toResponse(DirectMessage message, Long currentUserId) {
        boolean mine = message.getSender().getId().equals(currentUserId);
        return new PostDtos.MessageResponse(
                message.getId(),
                message.getSender().getId(),
                message.getSender().getDisplayName(),
                message.getRecipient().getId(),
                message.getRecipient().getDisplayName(),
                message.getContent(),
                message.getCreatedAt(),
                message.getReadAt(),
                mine
        );
    }

    private void createMessageNotification(AppUser sender, AppUser recipient) {
        NotificationItem item = new NotificationItem();
        item.setRecipient(recipient);
        item.setType("message");
        item.setMessage(sender.getDisplayName() + " sent you a message");
        item.setRead(false);
        item.setCreatedAt(Instant.now());

        NotificationItem saved = notificationRepository.save(item);
        notificationStreamService.publish(recipient.getId(), new PostDtos.NotificationResponse(
                saved.getId(),
                saved.getType(),
                saved.getMessage(),
                saved.isRead(),
                saved.getCreatedAt()
        ));
    }
}
