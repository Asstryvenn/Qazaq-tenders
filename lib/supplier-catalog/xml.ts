/**
 * Безопасный разбор XML (фиды каталога, $metadata 1С).
 * DOCTYPE и объявления сущностей запрещены целиком: это исключает XXE, «billion laughs»
 * и обращения к внешним DTD. fast-xml-parser (MIT) никогда не загружает внешние ресурсы.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { SourceError } from "./errors.ts";

export interface SafeXmlOptions {
  maxBytes: number;
  /** Элементы, которые всегда массив (offer, param, …) — без этого один элемент станет объектом. */
  arrays?: string[];
}

export type XmlNode = Record<string, unknown>;

export function parseSafeXml(text: string, options: SafeXmlOptions): XmlNode {
  if (new TextEncoder().encode(text).byteLength > options.maxBytes) throw new SourceError("too_large");
  const head = text.replace(/^﻿/, "");
  if (/<!DOCTYPE/i.test(head) || /<!ENTITY/i.test(head)) throw new SourceError("xml_dtd_forbidden");
  if (!head.trim().startsWith("<")) throw new SourceError("invalid_format", "not-xml");
  const validation = XMLValidator.validate(head, { allowBooleanAttributes: true });
  if (validation !== true) throw new SourceError("malformed_xml", `line ${validation.err.line}: ${validation.err.code}`);
  const arrays = new Set(options.arrays ?? []);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    removeNSPrefix: true,
    processEntities: true,
    htmlEntities: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    cdataPropName: false,
    isArray: (name) => arrays.has(name),
  });
  return parser.parse(head) as XmlNode;
}

/** Текст узла: строка, число или {#text}. */
export function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object" && "#text" in (node as XmlNode)) return textOf((node as XmlNode)["#text"]);
  return "";
}

export const attrOf = (node: unknown, name: string): string => (node && typeof node === "object" ? textOf((node as XmlNode)[`@_${name}`]) : "");

export const asArray = <T = XmlNode>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);

/** Корневой элемент документа (без <?xml?>). */
export function rootOf(doc: XmlNode): { name: string; node: XmlNode } | null {
  const keys = Object.keys(doc).filter((k) => !k.startsWith("?") && !k.startsWith("#"));
  if (keys.length !== 1) return null;
  const node = doc[keys[0]];
  return { name: keys[0], node: node && typeof node === "object" ? (node as XmlNode) : {} };
}
