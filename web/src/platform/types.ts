export interface PlatformAdmin {id:number;username:string;displayName:string}
export interface AiSummary {
  attempts:number;logicalRequests:number;success:number;failed:number;parseFailed:number
  promptTokens:number|null;completionTokens:number|null;cacheHitTokens:number|null;cacheMissTokens:number|null;totalTokens:number|null
  usageKnownAttempts:number;usageUnknownAttempts:number;estimatedCosts:{currency:string;amount:number}[];costKnownAttempts:number;costUnknownAttempts:number
  tokenCoverage?:Record<string,{known:number;unknown:number}>
}
export interface Range {from?:string;to?:string}
export interface Overview {
  range:Range;registrations:{users:number;stores:number;admins:number;staff:number;disabledUsers:number;firstRegistrationSource:string}
  registrationSources?:{password:number;apple:number;sms:number;staff:number;unknown:number}
  bindings:{appleUsers:number;phoneUsers:number;overlapUsers:number;interpretation?:string}
  entitlements:{currentProStores:number;currentVerifiedProductionProStores?:number;verifiedProductionStores:number;verifiedSandboxStores:number;manualStores:number;promotionStores:number;unknownAppleStores:number;verifiedProductionTransactions:number;verifiedSandboxTransactions:number;revenue:null}
  ai:AiSummary;notes:string[];telemetry?:Record<string,unknown>
}
export interface PlatformUser {id:number;storeId:number;username:string;realName:string;role:string;status:number;createdAt:string;store:{id:number;name:string}|null;bindings:{apple:boolean;phone:boolean};registrationSource:string}
export interface UserDetail {
  user:PlatformUser;counts:{products:number;skus:number;orders:number;purchaseOrders:number;aiAttempts:number};ai:AiSummary;range?:Range
  entitlements:{source:string;status:string;plan:string;environment:string|null;expiresAt:string|null;verified:boolean}[]
  purchaseStage:{earliestKnownPurchaseAt:string|null;registeredAt:string|null;firstOrderAt:string|null;firstAiAt:string|null;daysFromRegistration:number|null;phase:string;entry:string;attribution:string}
}
export interface AiRecord {id:string;requestId:string;userId:number;storeId:number;endpoint:string;model:string;attempt:number;status:string;durationMs:number;promptTokens:number|null;completionTokens:number|null;cacheHitTokens:number|null;cacheMissTokens:number|null;totalTokens:number|null;estimatedCost:number|null;currency:string|null;pricingSnapshot:Record<string,unknown>|null;errorCode:string|null;createdAt:string}
export interface Paged<T> {list:T[];pagination:{page:number;pageSize:number;total:number;totalPages:number}}
