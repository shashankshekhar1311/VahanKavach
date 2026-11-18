import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPageShell,
  LegalSection,
} from "@/components/legal/LegalPageShell";
import { LEGAL } from "@/lib/legal";


export const metadata: Metadata = {
  title: `Terms of Service — ${LEGAL.productName}`,
  description: `Terms of Service for ${LEGAL.productName}, operated by ${LEGAL.companyLegalName}.`,
};

export default function TermsOfServicePage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      description={`These Terms govern your access to and use of ${LEGAL.productName}, an independent private software platform operated by ${LEGAL.companyLegalName}. By creating an account or using the Service, you agree to these Terms.`}
    >
      <LegalSection number="1" title="Definitions">
        <p>
          <strong className="text-zinc-200">&quot;Service&quot;</strong> means
          the {LEGAL.productName} web and mobile applications, APIs, alerts, and
          related features.{" "}
          <strong className="text-zinc-200">&quot;You&quot;</strong> means the
          individual or entity using the Service.{" "}
          <strong className="text-zinc-200">&quot;Vehicle Data&quot;</strong>{" "}
          means registration, fitness, insurance, PUC, challan, and related
          compliance information obtained from licensed third-party providers
          that source official government databases.
        </p>
      </LegalSection>

      <LegalSection number="2" title="Nature of the Service">
        <p>
          {LEGAL.productName} is a private information and reminder platform. It
          is not a government portal, not a licensed RTO counter, and not a
          payment gateway for statutory fines unless you separately complete a
          payment on an official or third-party payment surface we may deep-link
          you to.
        </p>
        <p>
          We do not issue, cancel, or adjudicate challans, PUC certificates,
          insurance policies, or fitness certificates. Displayed data is provided
          for personal compliance awareness only.
        </p>
      </LegalSection>

      <LegalSection number="3" title="No Government Affiliation">
        <p>
          The Service is operated solely by {LEGAL.companyLegalName}. It is not
          affiliated with, authorized by, endorsed by, or officially connected
          with the Ministry of Road Transport and Highways (MoRTH), Parivahan
          Sewa, NIC, any State Transport Department, or any State Traffic Police
          department.
        </p>
      </LegalSection>

      <LegalSection number="4" title="Account & Eligibility">
        <p>
          You must provide accurate contact details (including a reachable phone
          number or email) and keep credentials confidential. You are responsible
          for all activity under your account. You may only claim vehicles you
          own or are lawfully authorized to manage.
        </p>
      </LegalSection>

      <LegalSection number="5" title="Service Limitations & Third-Party Data">
        <p>
          Vehicle Data is fetched via authorized licensed third-party data
          providers. Availability, accuracy, latency, and completeness depend on
          upstream government databases and provider systems that we do not
          control.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Lookups may fail, time out, return partial records, or reflect
            delayed updates when Parivahan / state systems are unavailable or
            under maintenance.
          </li>
          <li>
            Cached or previously synced values may temporarily differ from the
            live official record.
          </li>
          <li>
            Chassis / ownership verification is a fraud-prevention control and
            does not constitute a title search or legal ownership certificate.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="6" title="No Liability for Traffic Penalties">
        <p>
          You remain solely responsible for complying with the Motor Vehicles
          Act, 1988, applicable state rules, and all traffic, pollution, and
          insurance obligations. {LEGAL.companyLegalName} is not liable for any
          challan, fine, late fee, court process, vehicle seizure, insurance
          repudiation, or other penalty you incur—whether or not an alert was
          sent, delayed, missed, or inaccurate.
        </p>
        <p>
          Alerts (including Telegram or in-app notices) are convenience features
          and do not replace your duty to check official sources before driving
          or renewing documents.
        </p>
      </LegalSection>

      <LegalSection number="7" title="Subscriptions & Payments">
        <p>
          Paid plans (including per-vehicle subscriptions) are billed through
          payment partners such as Razorpay or Cashfree. Prices, renewals, and
          entitlements are described in-product at checkout. Refunds are governed
          by our{" "}
          <Link
            href="/refund"
            className="text-safety underline-offset-2 hover:underline"
          >
            Cancellation &amp; Refund Policy
          </Link>
          .

        </p>
      </LegalSection>

      <LegalSection number="8" title="Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Claim or monitor vehicles without lawful authority, or attempt to
            bypass ownership / chassis verification.
          </li>
          <li>
            Scrape, bulk-harvest, resell, or commercially redistribute Vehicle
            Data obtained through the Service.
          </li>
          <li>
            Interfere with the Service, probe for vulnerabilities without
            authorization, or reverse-engineer provider integrations beyond
            lawful interoperability.
          </li>
          <li>
            Use the Service for any unlawful purpose, including harassment,
            stalking, or unauthorized surveillance of third parties.
          </li>
          <li>
            Misrepresent {LEGAL.productName} as an official government service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="9" title="Intellectual Property">
        <p>
          The Service, branding, UI, and software are owned by{" "}
          {LEGAL.companyLegalName} or its licensors. Vehicle Data remains subject
          to applicable government and provider terms; you receive a limited,
          personal, non-transferable right to view it for compliance management.
        </p>
      </LegalSection>

      <LegalSection number="10" title="Disclaimer of Warranties">
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
          AVAILABLE.&quot; TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM
          ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS
          FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
          UNINTERRUPTED ACCESS OR ERROR-FREE DATA.
        </p>
      </LegalSection>

      <LegalSection number="11" title="Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,{" "}
          {LEGAL.companyLegalName.toUpperCase()} SHALL NOT BE LIABLE FOR
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
          FOR LOST PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE
          SERVICE OR RELIANCE ON VEHICLE DATA. OUR AGGREGATE LIABILITY FOR ANY
          CLAIM RELATING TO THE SERVICE SHALL NOT EXCEED THE FEES YOU PAID TO US
          FOR THE SERVICE IN THE THREE (3) MONTHS PRECEDING THE CLAIM.
        </p>
      </LegalSection>

      <LegalSection number="12" title="Termination">
        <p>
          You may stop using the Service and release vehicles from your garage
          at any time. We may suspend or terminate access for breach of these
          Terms, suspected fraud, non-payment, or legal risk. Provisions that by
          nature should survive (including liability limits and IP) will survive
          termination.
        </p>
      </LegalSection>

      <LegalSection number="13" title="Governing Law & Disputes">
        <p>
          These Terms are governed by the laws of India. Subject to mandatory
          consumer protections, courts at the place of our registered office
          shall have exclusive jurisdiction. Nothing limits your statutory rights
          under Indian consumer or data-protection law.
        </p>
      </LegalSection>

      <LegalSection number="14" title="Changes">
        <p>
          We may update these Terms from time to time. Material changes will be
          reflected by updating the &quot;Last updated&quot; date on this page.
          Continued use after changes constitutes acceptance of the revised
          Terms.
        </p>
      </LegalSection>

      <LegalSection number="15" title="Contact">
        <p>
          Questions about these Terms:{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="text-safety underline-offset-2 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          . Grievances: see our{" "}
          <Link
            href="/contact"
            className="text-safety underline-offset-2 hover:underline"
          >
            Contact / Grievance
          </Link>{" "}
          page.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
