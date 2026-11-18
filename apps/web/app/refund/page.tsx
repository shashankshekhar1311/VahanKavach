import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPageShell,
  LegalSection,
} from "@/components/legal/LegalPageShell";
import { LEGAL } from "@/lib/legal";


export const metadata: Metadata = {
  title: `Cancellation & Refund Policy — ${LEGAL.productName}`,
  description: `Cancellation and refund policy for ${LEGAL.productName} subscriptions and lookups (Razorpay / Cashfree merchant requirements).`,
};

export default function RefundPolicyPage() {
  return (
    <LegalPageShell
      title="Cancellation & Refund Policy"
      description={`This Policy describes how ${LEGAL.companyLegalName} handles cancellations and refunds for ${LEGAL.productName} paid plans and related charges, consistent with Razorpay / Cashfree merchant onboarding expectations and applicable Indian consumer protections.`}
    >
      <LegalSection number="1" title="Scope">
        <p>
          This Policy applies to digital subscription fees and one-time charges
          for {LEGAL.productName} paid features processed via our payment
          partners (including Razorpay and Cashfree). It does not govern
          statutory challan amounts paid on government or third-party payment
          portals we may deep-link to—those are outside our merchant settlement.
        </p>
      </LegalSection>

      <LegalSection number="2" title="Nature of the Product">
        <p>
          {LEGAL.productName} provides software access, vehicle monitoring
          entitlements, and related digital services. Once a lookup is
          successfully completed or an entitlement period begins, the digital
          service is considered delivered for that period, subject to the
          exceptions below.
        </p>
      </LegalSection>

      <LegalSection number="3" title="Cancellations">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            You may cancel auto-renewing subscriptions at any time from the
            in-app Billing panel or by emailing{" "}
            <a
              href={`mailto:${LEGAL.supportEmail}`}
              className="text-safety underline-offset-2 hover:underline"
            >
              {LEGAL.supportEmail}
            </a>{" "}
            from your registered email / with your registered phone.
          </li>
          <li>
            Cancellation stops future renewals. Access continues until the end
            of the already-paid entitlement period unless a refund is approved
            under Section 4.
          </li>
          <li>
            Releasing a vehicle from your garage does not automatically refund
            prepaid subscription time for that vehicle.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="4" title="Refund Eligibility">
        <p>We will approve refunds (full or partial, as appropriate) when:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-zinc-200">Failed lookups:</strong> You were
            charged for a paid lookup or add-on and the Service failed to return
            any usable Vehicle Data due to our platform error (not due to an
            invalid registration you entered, ownership verification failure, or
            upstream government / provider outage beyond a reasonable retry
            window we document in support).
          </li>
          <li>
            <strong className="text-zinc-200">Duplicate subscription charges:</strong>{" "}
            The same plan for the same vehicle / account was charged more than
            once for the same billing period because of a payment or webhook
            fault.
          </li>
          <li>
            <strong className="text-zinc-200">Unauthorized or erroneous payments:</strong>{" "}
            Proven unauthorized use of your payment instrument after timely
            notice, subject to payment-partner investigation.
          </li>
        </ul>
        <p>
          Refunds are generally <strong className="text-zinc-200">not</strong>{" "}
          available for change of mind after successful delivery of monitoring
          entitlements, for periods already consumed, or for dissatisfaction
          solely with third-party / government database content accuracy.
        </p>
      </LegalSection>

      <LegalSection number="5" title="Refund Turnaround (7 Days)">
        <p>
          Eligible refund requests acknowledged by support will be processed
          within <strong className="text-zinc-200">seven (7) business days</strong>{" "}
          of approval. Settlement to your original payment method may take
          additional bank / UPI / card network time (typically 5–10 business
          days thereafter). We will share a reference ID when the refund is
          initiated with Razorpay, Cashfree, or the relevant partner.
        </p>
      </LegalSection>

      <LegalSection number="6" title="How to Request a Refund">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Email{" "}
            <a
              href={`mailto:${LEGAL.supportEmail}`}
              className="text-safety underline-offset-2 hover:underline"
            >
              {LEGAL.supportEmail}
            </a>{" "}
            with subject line &quot;Refund Request — {LEGAL.productName}&quot;.
          </li>
          <li>
            Include registered phone/email, vehicle registration (if
            applicable), payment ID / order ID from Razorpay or Cashfree, amount,
            date, and a short description of the issue.
          </li>
          <li>
            We may ask for screenshots of failed lookups or duplicate charges to
            validate eligibility.
          </li>
        </ol>
      </LegalSection>

      <LegalSection number="7" title="Chargebacks">
        <p>
          Please contact us before raising a chargeback so we can resolve the
          issue quickly. Unfounded chargebacks may result in account suspension
          pending investigation.
        </p>
      </LegalSection>

      <LegalSection number="8" title="Contact">
        <p>
          Billing support:{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="text-safety underline-offset-2 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          . Escalations: Grievance Redressal Officer on our{" "}
          <Link
            href="/contact"
            className="text-safety underline-offset-2 hover:underline"
          >
            Contact
          </Link>{" "}
          page.

        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
