import type { RawObject } from "./types";

// Xero Accounting API. Sales-relevant slice: invoices, contacts (billing
// counterparty), and payments. Feeds new canonical Invoice plus light
// contributions to Account (billing identity).

export const XERO_OBJECTS: readonly RawObject[] = [
  {
    source: "Xero",
    object: "Invoice",
    fields: [
      { key: "invoice_id", type: "string", description: "Xero invoice UUID" },
      { key: "invoice_number", type: "string", description: "Human invoice number (e.g. INV-001234)" },
      { key: "type", type: "enum", description: "Invoice direction", enumValues: ["ACCREC", "ACCPAY"] },
      { key: "status", type: "enum", description: "Lifecycle status", enumValues: ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"] },
      { key: "contact_id", type: "string", description: "Linked Xero Contact (billing counterparty)" },
      { key: "date", type: "date", description: "Invoice issue date" },
      { key: "due_date", type: "date", description: "Payment due date" },
      { key: "fully_paid_on_date", type: "date", description: "Date invoice was fully paid" },
      { key: "currency_code", type: "string", description: "Currency (ISO 4217)" },
      { key: "subtotal", type: "float", description: "Subtotal before tax" },
      { key: "total_tax", type: "float", description: "Total tax amount" },
      { key: "total", type: "float", description: "Total amount due" },
      { key: "amount_paid", type: "float", description: "Amount paid to date" },
      { key: "amount_due", type: "float", description: "Outstanding balance" },
      { key: "amount_credited", type: "float", description: "Amount credited via credit note" },
      { key: "reference", type: "string", description: "Reference field (often opportunity ID or PO)" },
      { key: "branding_theme_id", type: "string", description: "Branding theme" },
      { key: "line_amount_types", type: "enum", description: "How line amounts are stated", enumValues: ["Exclusive", "Inclusive", "NoTax"] },
      { key: "sent_to_contact", type: "bool", description: "Whether invoice was emailed" },
      { key: "expected_payment_date", type: "date", description: "Expected payment date" },
      { key: "is_overdue", type: "bool", description: "Past due date and unpaid" },
    ],
  },
  {
    source: "Xero",
    object: "Contact",
    fields: [
      { key: "contact_id", type: "string", description: "Xero contact identifier" },
      { key: "name", type: "string", description: "Business name" },
      { key: "contact_number", type: "string", description: "Contact reference number" },
      { key: "account_number", type: "string", description: "Account number" },
      { key: "contact_status", type: "enum", description: "Contact status", enumValues: ["ACTIVE", "ARCHIVED", "GDPRREQUEST"] },
      { key: "is_customer", type: "bool", description: "True if this contact is a customer" },
      { key: "is_supplier", type: "bool", description: "True if this contact is a supplier" },
      { key: "first_name", type: "string", description: "Primary person first name" },
      { key: "last_name", type: "string", description: "Primary person last name" },
      { key: "email_address", type: "string", description: "Primary email" },
      { key: "phone_number", type: "string", description: "Primary phone" },
      { key: "tax_number", type: "string", description: "Tax identifier (VAT/GST/EIN)" },
      { key: "default_currency", type: "string", description: "Default currency code" },
      { key: "addresses", type: "text", description: "Address list (POBOX, STREET, DELIVERY)" },
    ],
  },
  {
    source: "Xero",
    object: "Payment",
    fields: [
      { key: "payment_id", type: "string", description: "Payment identifier" },
      { key: "invoice_id", type: "string", description: "Invoice the payment applies to" },
      { key: "date", type: "date", description: "Payment date" },
      { key: "amount", type: "float", description: "Payment amount" },
      { key: "currency_rate", type: "float", description: "FX rate applied" },
      { key: "reference", type: "string", description: "Payment reference" },
      { key: "payment_type", type: "string", description: "Payment type label" },
      { key: "status", type: "enum", description: "Status", enumValues: ["AUTHORISED", "DELETED"] },
    ],
  },
];
