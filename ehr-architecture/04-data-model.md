# Data Model for Patient Records and Billing

This document outlines the basic data model for the EHR system, focusing on the core entities for patient records and billing. This is a simplified model and would need to be expanded for a full implementation.

## Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    PATIENT ||--o{ APPOINTMENT : "schedules"
    PATIENT ||--o{ CLINICAL_RECORD : "has"
    PATIENT ||--o{ INVOICE : "receives"
    PROVIDER ||--o{ APPOINTMENT : "has"
    APPOINTMENT ||--|{ CLINICAL_RECORD : "generates"
    INVOICE ||--|{ INVOICE_ITEM : "contains"
    SERVICE_CODE ||--o{ INVOICE_ITEM : "is for"

    PATIENT {
        int id PK
        string first_name
        string last_name
        date date_of_birth
        string address
        string phone_number
        string insurance_policy_number
    }

    PROVIDER {
        int id PK
        string first_name
        string last_name
        string specialty
    }

    APPOINTMENT {
        int id PK
        int patient_id FK
        int provider_id FK
        datetime start_time
        datetime end_time
        string status
    }

    CLINICAL_RECORD {
        int id PK
        int patient_id FK
        int appointment_id FK
        text subjective_notes
        text objective_notes
        text assessment
        text plan
    }

    INVOICE {
        int id PK
        int patient_id FK
        date issue_date
        date due_date
        decimal total_amount
        string status
    }

    INVOICE_ITEM {
        int id PK
        int invoice_id FK
        int service_code_id FK
        string description
        decimal amount
    }

    SERVICE_CODE {
        int id PK
        string code
        string description
        decimal price
    }
```

## Table Descriptions

- **PATIENT:** Stores demographic and insurance information for each patient.
- **PROVIDER:** Stores information about the healthcare providers in the clinic.
- **APPOINTMENT:** Manages scheduled appointments for patients with providers.
- **CLINICAL_RECORD:** Contains the clinical notes (SOAP format) for each patient encounter.
- **INVOICE:** Represents a bill for services rendered to a patient.
- **INVOICE_ITEM:** A line item on an invoice, corresponding to a specific service provided.
- **SERVICE_CODE:** A list of standard medical service codes (e.g., CPT codes) and their prices.