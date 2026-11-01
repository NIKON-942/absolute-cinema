# Non-Functional Requirements

## 1. Performance & Reliability
* **Availability:** System uptime must be at least 99.9% (maximum 9 hours of downtime per year).
* **Recovery Time:** Average recovery time after a critical failure must not exceed 1 hour.
* **Concurrency:** The system must support at least 1,000 active concurrent users without noticeable performance degradation.
* **Load Times:** 
  * Main catalog page must load in under 2 seconds (on a 10 Mbps connection).
  * Initial video buffering delay must not exceed 5 seconds.

## 2. Security & Data Protection
* **Data Transit:** All client-server communication must occur strictly over HTTPS (TLS 1.2+).
* **Password Storage:** Passwords must be stored exclusively as cryptographic hashes.
* **Data Privacy:** Full compliance with Ukrainian personal data protection laws and international GDPR standards.
* **Secrets Management:** Database credentials and API keys must be stored in secure environment variables, never in the source code.
* **PCI DSS Compliance:** The system delegates credit card processing to an external gateway, avoiding the storage of raw card numbers or CVVs in the local database.

## 3. Usability & Maintenance
* **Localization:** UI must support English and Ukrainian with instant switching without page reloads.
* **Backups:** The system must support regular automated database backups.
* **Data Retention:** User watch history must be retained for 1 year from their last activity.
