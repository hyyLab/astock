// 「无数据」错误标记：数据库为空 / 指定日期数据缺失。
// API 路由据此返回明确的 4xx（404）与提示信息，而不是未处理的 500。
export class EmptyDataError extends Error {}
