package com.pulse.api;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmailIgnoreCase(String email);

    Optional<AppUser> findByHandleIgnoreCase(String handle);

    boolean existsByEmailIgnoreCase(String email);

    boolean existsByHandleIgnoreCase(String handle);
}
