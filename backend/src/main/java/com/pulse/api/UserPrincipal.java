package com.pulse.api;

import org.springframework.lang.NonNull;

public record UserPrincipal(
        @NonNull Long id,
        String email,
        String handle,
        String displayName
) {
}
