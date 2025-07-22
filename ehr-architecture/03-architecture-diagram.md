# High-Level Architecture Diagram

This diagram illustrates the high-level architecture of the EHR application. It follows a classic three-tier architecture pattern, which separates the user interface, application logic, and data storage into distinct layers.

```mermaid
graph TD
    subgraph "User Layer"
        A[Web Browser]
    end

    subgraph "Application Layer"
        B[Frontend Web Server - React/Vue]
        C[Backend API Server - Node.js/NestJS]
        D[Authentication Service - JWT/OAuth]
    end

    subgraph "Data Layer"
        E[PostgreSQL Database]
        F[FHIR Server - for Interoperability]
    end

    subgraph "External Services"
        G[Lab Systems]
        H[Pharmacy Systems]
        I[Payment Gateway]
    end

    A -- HTTPS --> B
    B -- API Calls --> C
    C -- Authenticates with --> D
    C -- Reads/Writes --> E
    C -- Interacts with --> F
    F -- Exchanges Data with --> G
    F -- Exchanges Data with --> H
    C -- Processes Payments via --> I
```

## Component Descriptions

- **Web Browser:** The client application that users (doctors, nurses, receptionists) interact with.
- **Frontend Web Server:** Serves the single-page application (SPA) built with React or Vue.js.
- **Backend API Server:** The core of the application, handling business logic, data processing, and communication with the database and external services.
- **Authentication Service:** Manages user login and API security using JWT and OAuth 2.0.
- **PostgreSQL Database:** The primary data store for all patient, clinical, and billing information.
- **FHIR Server:** A dedicated server to handle data exchange with external healthcare systems using the FHIR standard. This promotes interoperability.
- **External Services:** Third-party systems that the EHR interacts with, such as labs for test results, pharmacies for e-prescribing, and payment gateways for billing.