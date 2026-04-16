package com.pulse.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Objects;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class SecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void meEndpointRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(Objects.requireNonNull(MediaType.APPLICATION_JSON)))
                .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void loginEndpointRemainsPublic() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                        .content("{\"email\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void messageInboxRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/messages/inbox"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(Objects.requireNonNull(MediaType.APPLICATION_JSON)))
                .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void suggestedUsersRequiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/users/suggested"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(Objects.requireNonNull(MediaType.APPLICATION_JSON)))
                .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void postsEndpointRemainsPublic() throws Exception {
        mockMvc.perform(get("/api/posts"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(Objects.requireNonNull(MediaType.APPLICATION_JSON)));
    }
}
