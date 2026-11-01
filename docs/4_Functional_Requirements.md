# Functional Requirements Specification (FRS)

This document provides the exhaustive breakdown of all 44 functional requirements (FR-1 through FR-44) for the **AbsoluteCinema** Video on Demand (VoD) platform.

---

## 1. User Registration & Authentication (FR-1 – FR-7, FR-19 – FR-22)

- **FR-1 (User Registration System):** The system must provide a mechanism for creating new user accounts to grant access to the online cinema platform services.
- **FR-2 (Credential Validation):** The system must validate email formatting (valid RFC format with `@` and domain), password complexity (minimum 8 characters including letters and special characters), and verify the uniqueness of the email in the database.
- **FR-3 (User Profile Creation):** The system must create a new record in the relational database, securely hash passwords using a strong cryptographic algorithm (e.g., Bcrypt), and initialize the default user profile.
- **FR-4 (Registration Email Dispatch):** The system must trigger an automated service confirmation email to the user's email address upon successful account creation.
- **FR-5 (User Authentication System):** The system must provide an identification and authentication mechanism for registered users to log into their personal account.
- **FR-6 (Password Verification & Access Rejection):** The system must verify the submitted password against the stored cryptographic hash, locking out unauthorized access and displaying descriptive error messages on failure.
- **FR-7 (Active Session & Token Management):** The system must generate, issue, and manage secure JSON Web Tokens (JWT) / session tokens to persist the authenticated user's state across requests.
- **FR-19 (Third-Party Identity Providers):** The system must support accelerated single-click authentication via external identity providers without requiring manual form input.
- **FR-20 (Google OAuth 2.0 Integration):** The system must implement the OAuth 2.0 protocol with Google API to authenticate users securely and retrieve basic account data (email, name, avatar).
- **FR-21 (Account Recovery System):** The system must provide a secure workflow for resetting lost passwords and setting new credentials.
- **FR-22 (Security Token Generation & Reset Email):** The system must generate a unique, single-use, time-limited security token (24-hour expiration window) and dispatch password reset instructions to the registered email address.

---

## 2. Media Content Playback & Streaming (FR-8 – FR-12)

- **FR-8 (Media Content Playback):** The system must provide streaming transmission of high-definition video files from cloud/network storage directly into the client-side video player.
- **FR-9 (Access Rights & Subscription Validation):** The system must verify the user's active subscription status in the database prior to initializing video stream delivery.
- **FR-10 (Continuous Video Streaming):** The system must deliver continuous video data utilizing chunked data transfers (HTTP Range Requests / partial content) with adaptive client-side buffering for playback stability.
- **FR-11 (Stream Quality Control):** The system must provide a UI interface within the custom video player allowing manual resolution switching (e.g., 480p, 720p, 1080p, 4K).
- **FR-12 (Watch History & Content Rating):** The system must automatically persist playback events and timestamp positions (in seconds) to the user's profile history and enable users to rate content on a 10-point scale.

---

## 3. Subscription & Payment Management (FR-13 – FR-15)

- **FR-13 (Subscription Tier Management):** The system must display available subscription plans (Basic, Standard, Premium), pricing details, functional tier perks, and allow switching between monthly and annual billing cycles.
- **FR-14 (External Payment Gateway Integration):** The system must facilitate secure payment processing via an external PCI DSS-compliant payment gateway (e.g., Stripe) using credit/debit cards.
- **FR-15 (Automatic Role & Access Granting):** The system must automatically update the user's role, permissions, and subscription expiration timestamp in the database immediately upon receiving a successful payment confirmation webhook.

---

## 4. Recommendation Engine (FR-16 – FR-18)

- **FR-16 (Personalized Recommendation System):** The system must suggest relevant movies to the user based on algorithmic analysis of their previous platform activity and expressed preferences.
- **FR-17 (Dynamic Content-Based Recommendations):** The system must calculate attribute similarity vectors (matching genres, directors, and cast) against the user's viewing history and ratings to generate a tailored recommendation feed.
- **FR-18 (Cold-Start Fallback Recommendations):** The system must generate a fallback feed of platform-wide top trending, highest-rated, or newly released movies for users who have no accumulated viewing history.

---

## 5. Catalog Navigation, Discovery & Favorites (FR-23 – FR-27, FR-31 – FR-33)

- **FR-23 (Catalog Search & Filtration System):** The system must provide tools for rapid catalog navigation and content discovery matching custom search parameters.
- **FR-24 (Metadata & Title Search):** The system must perform case-insensitive substring and exact keyword searches against movie titles in the database.
- **FR-25 (Faceted Filtering):** The system must filter media catalog items by arbitrary combinations of criteria, including genre lists, release year ranges, origin country, and age classification ratings.
- **FR-26 (Favorites List Management):** The system must allow users to bookmark individual movie items into a personalized "Favorites" / "Watchlist" collection for quick retrieval.
- **FR-27 (Favorites Editing & Deletion):** The system must allow users to view, manage, and remove individual entries from their saved favorites collection.
- **FR-31 (Catalog Navigation & Pagination):** The system must structure the media library with optimized pagination (e.g., 20 items per page) to ensure minimal network payload and fast page rendering.
- **FR-32 (Catalog Overview & Card Grid):** The system must render a responsive grid of movie cards displaying essential metadata (poster image, title, release year, audience rating).
- **FR-33 (Movie Details Page Generation):** The system must generate a comprehensive movie view containing detailed descriptions, trailers, full actor/director credits, runtime, genre tags, and related movie suggestions.

---

## 6. User Profile & Account Settings (FR-34 – FR-36)

- **FR-34 (Personal Profile Management):** The system must provide an authenticated user dashboard to customize personal preferences and display settings.
- **FR-35 (View & Edit Personal Information):** The system must allow users to update display names, avatars, and review current subscription plan status and renewal dates.
- **FR-36 (Account Security Settings):** The system must provide interfaces for changing account passwords and performing secure logout (revoking active access tokens).

---

## 7. Media Library & Taxonomy Administration (FR-28 – FR-30, FR-37 – FR-39)

- **FR-28 (Media Library Administration):** The system must provide administrators with an authenticated dashboard for comprehensive management of all platform media assets.
- **FR-29 (Media Asset Upload & Asset Storage):** The system must support uploading high-definition video files (H.264/H.265/WebM) and poster graphics (JPG, PNG, WebP) via Drag-and-Drop or direct URL input into dedicated server/cloud storage.
- **FR-30 (Movie Records CRUD Operations):** The system must provide administrators with complete Create, Read, Update, and Delete (CRUD) capabilities for movie entity records in the database.
- **FR-37 (System Dictionaries Administration):** The system must provide centralized control over auxiliary dictionary datasets to preserve relational data integrity.
- **FR-38 (Static Taxonomy Management):** The system must allow administrators to manage, create, and edit standardized lists of genres and countries.
- **FR-39 (Cast & Crew Directory Management):** The system must maintain a registry of actors and directors with relational links to associated movie records.

---

## 8. User Moderation & Analytics (FR-40 – FR-44)

- **FR-40 (User Management Console):** The system must provide administrator tools to monitor platform activity and audit all registered user accounts.
- **FR-41 (Registered User Directory):** The system must render a searchable table of registered users displaying registration dates, last login timestamps, and current subscription statuses.
- **FR-42 (User Role Administration):** The system must allow super-administrators to escalate or revoke privileges and assign roles (e.g., `User`, `Moderator`, `Administrator`).
- **FR-43 (Analytics & Reporting Dashboard):** The system must aggregate and visualize operational metrics and business intelligence data.
- **FR-44 (Content Popularity & Metrics Analytics):** The system must generate analytical reports detailing total video views, average audience ratings, and genre popularity over selectable time intervals.
