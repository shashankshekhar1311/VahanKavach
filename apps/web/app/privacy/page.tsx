import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPageShell,
  LegalSection,
} from "@/components/legal/LegalPageShell";
import { LEGAL } from "@/lib/legal";


export const metadata: Metadata = {
  title: `Privacy Policy — ${LEGAL.productName}`,
  description: `Privacy Policy for ${LEGAL.productName}, aligned with the Digital Personal Data Protection Act, 2023.`,
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      description={`${LEGAL.companyLegalName} ("we", "us") operates ${LEGAL.productName}. This Policy explains how we process personal data in connection with the Service, consistent with the Digital Personal Data Protection Act, 2023 ("DPDP Act") and applicable rules.`}
    >
      <LegalSection number="1" title="Data Fiduciary">
        <p>
          The Data Fiduciary for processing described here is{" "}
          {LEGAL.companyLegalName}, with registered office at{" "}
          {LEGAL.registeredAddress}. Contact:{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="text-safety underline-offset-2 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection number="2" title="Personal Data We Collect">
        <p>Depending on how you use the Service, we may process:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-zinc-200">Account identifiers:</strong>{" "}
            phone number and/or email address, authentication OTP metadata, and
            session tokens.
          </li>
          <li>
            <strong className="text-zinc-200">Vehicle registration numbers</strong>{" "}
            you submit to add or claim a vehicle in your garage.
          </li>
          <li>
            <strong className="text-zinc-200">Masked chassis numbers:</strong>{" "}
            typically the last five characters used solely to verify ownership
            claims (we do not require a full VIN/chassis for ordinary use).
          </li>
          <li>
            <strong className="text-zinc-200">Vehicle compliance fields</strong>{" "}
            returned by licensed providers (e.g., make/model descriptors, PUC /
            insurance / fitness expiry indicators, challan summaries).
          </li>
          <li>
            <strong className="text-zinc-200">Notification preferences</strong>{" "}
            (e.g., Telegram chat linkage identifiers you authorize).
          </li>
          <li>
            <strong className="text-zinc-200">Billing metadata:</strong>{" "}
            subscription status, entitlement periods, payment attempt references
            from Razorpay/Cashfree (card/UPI secrets are handled by the payment
            partner, not stored by us in full).
          </li>
          <li>
            <strong className="text-zinc-200">Technical logs:</strong> IP
            address, device/browser type, timestamps, and error diagnostics
            needed to secure and operate the Service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="3" title="Purpose of Processing">
        <p>We process personal data to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Create and secure your account;</li>
          <li>
            Fetch, cache, and display Vehicle Data you request for compliance
            awareness;
          </li>
          <li>Verify vehicle claims and prevent unauthorized access;</li>
          <li>Send expiry and challan alerts you enable;</li>
          <li>Process subscriptions and prevent payment fraud;</li>
          <li>Respond to support and grievance requests;</li>
          <li>
            Comply with law, enforce Terms, and maintain Service integrity.
          </li>
        </ul>
        <p>
          We do not sell personal data. We do not use Vehicle Data to train
          public generative AI models.
        </p>
      </LegalSection>

      <LegalSection number="4" title="Legal Basis & Consent (DPDP Act 2023)">
        <p>
          Processing is grounded in your consent when you create an account, add
          a vehicle, link a notification channel, or complete checkout, and in
          legitimate uses necessary to provide the Service you request. Where
          processing is required to perform a contract with you (e.g., paid
          monitoring), we rely on that contractual necessity. You may withdraw
          consent prospectively by deleting your account, releasing vehicles, or
          disabling channels, subject to retention needed for legal or security
          purposes.
        </p>
      </LegalSection>

      <LegalSection number="5" title="Sharing & Processors">
        <p>We share data only as needed with:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Licensed vehicle / challan data providers (to perform lookups you
            initiate);
          </li>
          <li>
            Infrastructure and auth providers (e.g., Supabase) hosting the
            Service;
          </li>
          <li>Payment partners (Razorpay / Cashfree) for billing;</li>
          <li>
            Messaging platforms you connect (e.g., Telegram) to deliver alerts;
          </li>
          <li>
            Competent authorities when required by law or to protect rights and
            safety.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="6" title="Cross-Border Transfers">
        <p>
          Primary databases are intended to be hosted in regions supporting
          Indian operations. If a processor stores data outside India, we will
          take contractual and technical steps consistent with the DPDP Act and
          applicable government notifications.
        </p>
      </LegalSection>

      <LegalSection number="7" title="Retention">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Account and garage data: retained while your account is active and
            for a reasonable wind-down period after deletion (typically up to 90
            days) unless a longer period is required for disputes or law.
          </li>
          <li>
            Vehicle sync / cache records: retained for the life of the claim
            plus short operational history for debugging failed lookups.
          </li>
          <li>
            Billing and payment attempt records: retained as required for tax,
            chargeback, and merchant compliance (often 8 years or as mandated).
          </li>
          <li>
            Security logs: retained for a limited period necessary to detect
            abuse.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="8" title="Security">
        <p>
          We apply industry-standard controls including encryption in transit
          (TLS), access-controlled databases with row-level security where
          applicable, and least-privilege service roles. No method of
          transmission or storage is 100% secure; please protect your OTP and
          devices.
        </p>
      </LegalSection>

      <LegalSection number="9" title="Your Rights">
        <p>Subject to the DPDP Act and applicable exceptions, you may:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Access a summary of personal data we hold about you;</li>
          <li>Correct inaccurate or incomplete personal data;</li>
          <li>
            Request erasure of personal data no longer needed for the stated
            purposes;
          </li>
          <li>Withdraw consent for optional processing;</li>
          <li>
            Nominate another individual to exercise rights in case of death or
            incapacity, where provided by law.
          </li>
        </ul>
        <p>
          To exercise rights, email{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="text-safety underline-offset-2 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>{" "}
          or use the grievance channel on our{" "}
          <Link
            href="/contact"
            className="text-safety underline-offset-2 hover:underline"
          >
            Contact
          </Link>{" "}
          page. We will respond within timelines required by law.

        </p>
      </LegalSection>

      <LegalSection number="10" title="Children">
        <p>
          The Service is intended for adults who own or manage motor vehicles.
          We do not knowingly collect personal data from children. If you believe
          a minor has provided data, contact us for deletion.
        </p>
      </LegalSection>

      <LegalSection number="11" title="Changes">
        <p>
          We may update this Policy periodically. The &quot;Last updated&quot;
          date at the top of this page will change when we do. Material changes
          may also be notified in-app or by email where appropriate.
        </p>
      </LegalSection>

      <LegalSection number="12" title="Grievance">
        <p>
          For privacy complaints, contact our Grievance Redressal Officer as
          listed on the{" "}
          <Link
            href="/contact"
            className="text-safety underline-offset-2 hover:underline"
          >
            Contact / Grievance
          </Link>{" "}
          page, designated under Rule 3(2) of the Information Technology
          (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021,
          to the extent applicable.

        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
