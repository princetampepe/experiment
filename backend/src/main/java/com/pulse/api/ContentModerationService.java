package com.pulse.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

@Service
public class ContentModerationService {

    private final List<String> blockedTerms;

    public ContentModerationService(@Value("${app.moderation.blocked-terms:}") String blockedTermsValue) {
        this.blockedTerms = Arrays.stream(blockedTermsValue.split(","))
                .map(String::trim)
                .filter(term -> !term.isBlank())
                .map(term -> term.toLowerCase(Locale.ROOT))
                .toList();
    }

    public void assertAllowed(String content) {
        String normalized = content == null ? "" : content.toLowerCase(Locale.ROOT);
        for (String blockedTerm : blockedTerms) {
            if (normalized.contains(blockedTerm)) {
                throw new IllegalArgumentException("Post contains blocked content");
            }
        }
    }
}
