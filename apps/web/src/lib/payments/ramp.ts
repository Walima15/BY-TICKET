/**
 * Mobile money on/off-ramp boundary (MTN MoMo, Airtel Money, Zamtel Kwacha).
 *
 * The rest of the app only talks to `PaymentRampAdapter`. A real provider
 * (direct API or a Stellar anchor via SEP-24/31) implements this interface; the
 * ticket is minted only after `getStatus` reports `settled` and USDC has landed.
 */

export type RampProvider = "stub" | "mtn_momo" | "airtel_money" | "zamtel_kwacha";

export type RampStatus = "pending" | "awaiting_customer" | "settled" | "failed" | "expired";

export interface OnRampRequest {
  /** Our idempotency key; providers must de-duplicate on it. */
  reference: string;
  /** Amount the customer pays, in ngwee (ZMW minor units). */
  amountNgwee: bigint;
  /** MSISDN in E.164, e.g. +260971234567. */
  phone: string;
  /** Stellar account (G...) or contract (C...) that receives the USDC. */
  destination: string;
}

export interface OffRampRequest {
  reference: string;
  /** USDC to pay out, in 7-decimal units. */
  amountUsdcUnits: bigint;
  phone: string;
}

export interface RampSession {
  provider: RampProvider;
  reference: string;
  providerReference: string;
  status: RampStatus;
  /** Shown to the user, e.g. "Approve the prompt on your phone". */
  instructions?: string;
}

export interface PaymentRampAdapter {
  readonly provider: RampProvider;
  startOnRamp(req: OnRampRequest): Promise<RampSession>;
  startOffRamp(req: OffRampRequest): Promise<RampSession>;
  getStatus(reference: string): Promise<RampSession>;
  /** Verify and parse a provider webhook. Must reject bad signatures. */
  parseWebhook(headers: Headers, rawBody: string): Promise<RampSession>;
}

/** In-memory stub: every request settles immediately. Testnet/dev only. */
export class StubRampAdapter implements PaymentRampAdapter {
  readonly provider = "stub" as const;
  private sessions = new Map<string, RampSession>();

  async startOnRamp(req: OnRampRequest): Promise<RampSession> {
    return this.settle(req.reference, "Stub: payment auto-approved");
  }

  async startOffRamp(req: OffRampRequest): Promise<RampSession> {
    return this.settle(req.reference, "Stub: payout auto-sent");
  }

  async getStatus(reference: string): Promise<RampSession> {
    const session = this.sessions.get(reference);
    if (!session) throw new Error(`Unknown ramp reference: ${reference}`);
    return session;
  }

  async parseWebhook(): Promise<RampSession> {
    throw new Error("Stub ramp adapter does not receive webhooks");
  }

  private settle(reference: string, instructions: string): RampSession {
    const existing = this.sessions.get(reference);
    if (existing) return existing;
    const session: RampSession = {
      provider: this.provider,
      reference,
      providerReference: `stub_${reference}`,
      status: "settled",
      instructions,
    };
    this.sessions.set(reference, session);
    return session;
  }
}

export function createRampAdapter(provider: RampProvider): PaymentRampAdapter {
  switch (provider) {
    case "stub":
      return new StubRampAdapter();
    default:
      throw new Error(`Payment ramp provider "${provider}" is not implemented yet (see docs/ROADMAP.md)`);
  }
}
