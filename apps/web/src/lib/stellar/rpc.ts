import { rpc } from "@stellar/stellar-sdk";
import { stellarConfig } from "./config";

let server: rpc.Server | undefined;

/** Shared Soroban RPC client. `allowHttp` only for local standalone networks. */
export function getRpc(): rpc.Server {
  server ??= new rpc.Server(stellarConfig.rpcUrl, {
    allowHttp: stellarConfig.rpcUrl.startsWith("http://"),
  });
  return server;
}
