import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPageShell,
  LegalSection,
} from "@/components/legal/LegalPageShell";
import { LEGAL } from "@/lib/legal";


export const metadata: Metadata = {
  title: `Contact & Grievance — ${LEGAL.productName}`,
  description: `Contact ${LEGAL.companyLegalName} for ${LEGAL.productName} support and grievance redressal.`,
};

export default function ContactPage() {
  return (
    <LegalPageShell
      title="Contact Us & Grievance Redressal"
      description={`Reach ${LEGAL.companyLegalName} for product support, billing, privacy requests, and formal grievances related to ${LEGAL.productName}.`}
    >
      <LegalSection number="1" title="Product Support">
        <dl className="space-y-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Support email
            </dt>
            <dd className="mt-0.5">
              <a
                href={`mailto:${LEGAL.supportEmail}`}
                className="font-medium text-safety underline-offset-2 hover:underline"
              >
                {LEGAL.supportEmail}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Business hours
            </dt>
            <dd className="mt-0.5 text-zinc-300">{LEGAL.businessHours}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Typical response
            </dt>
            <dd className="mt-0.5 text-zinc-300">
              We aim to acknowledge support tickets within one (1) business day
              during operating hours.
            </dd>
          </div>
        </dl>
      </LegalSection>

      <LegalSection number="2" title="Registered Office">
        <p className="whitespace-pre-line text-zinc-300">
          {LEGAL.companyLegalName}
          {"\n"}
          {LEGAL.registeredAddress}
        </p>
        <p className="text-xs text-zinc-600">
          Replace the address placeholder via{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-400">
            NEXT_PUBLIC_REGISTERED_OFFICE_ADDRESS
          </code>{" "}
          before production launch / payment-partner KYC.
        </p>
      </LegalSection>

      <LegalSection number="3" title="Grievance Redressal Officer">
        <p>
          In accordance with{" "}
          <strong className="text-zinc-200">
            Rule 3(2) of the Information Technology (Intermediary Guidelines and
            Digital Media Ethics Code) Rules, 2021
          </strong>
          , and for complaints relating to the Service (including privacy and
          content-related grievances to the extent applicable), the following
          officer is designated:
        </p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Name
              </dt>
              <dd className="mt-0.5 font-medium text-zinc-100">
                {LEGAL.grievanceOfficerName}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Designation
              </dt>
              <dd className="mt-0.5 text-zinc-300">
                Grievance Redressal Officer
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Email
              </dt>
              <dd className="mt-0.5">
                <a
                  href={`mailto:${LEGAL.grievanceEmail}`}
                  className="font-medium text-safety underline-offset-2 hover:underline"
                >
                  {LEGAL.grievanceEmail}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Postal address
              </dt>
              <dd className="mt-0.5 whitespace-pre-line text-zinc-300">
                {LEGAL.registeredAddress}
              </dd>
            </div>
          </dl>
        </div>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Please include your registered phone/email, a clear description of
            the grievance, and any payment or vehicle reference IDs.
          </li>
          <li>
            The Grievance Officer shall acknowledge the complaint and dispose of
            it within the timelines prescribed under the IT Rules (as
            applicable), and in any event we endeavour to resolve within fifteen
            (15) days where feasible.
          </li>
          <li>
            If you are not satisfied with the resolution, you may escalate to
            the appropriate appellate / regulatory mechanism provided under
            Indian law.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number="4" title="Policy Links">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <Link
              href="/terms"
              className="text-safety underline-offset-2 hover:underline"
            >
              Terms of Service
            </Link>
          </li>
          <li>
            <Link
              href="/privacy"
              className="text-safety underline-offset-2 hover:underline"
            >
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link
              href="/refund"
              className="text-safety underline-offset-2 hover:underline"
            >
              Cancellation &amp; Refund Policy
            </Link>
          </li>
        </ul>
      </LegalSection>
    </LegalPageShell>
  );
}
