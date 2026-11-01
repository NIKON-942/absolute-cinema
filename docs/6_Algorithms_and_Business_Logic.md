# Algorithms and Business Logic

## 1. Recommendation Engine (Content-Based Filtering)
To solve the "cold start" problem for new users, the platform implements a **Content-Based Filtering** algorithm rather than Collaborative Filtering. 
* **Mechanism:** The algorithm matches the attributes of movies (metadata: genres, directors, cast, keywords) with the user's previously demonstrated interests (watch history and ratings).
* **Fallback:** If a user has no watch history, the system dynamically falls back to generating a standardized list of the most popular or newly added films.
* **Database Synergy:** This approach integrates perfectly with the strict relational ORM structure, executing logic via optimized SQL queries.

## 2. Subscription and Payment Flow
1. User selects a tier and initiates payment.
2. System creates a pending order and redirects to the external payment gateway.
3. System waits for a webhook/callback (20-minute timeout). 
4. If payment fails, the user is given up to 3 retries.
5. Upon success, the system updates the user's role to grant Premium access.

## 3. Registration Flow
1. User submits email/password.
2. System validates format and checks for uniqueness.
3. System hashes the password and saves the user.
4. System triggers the external Email Service to send a welcome/confirmation email.
