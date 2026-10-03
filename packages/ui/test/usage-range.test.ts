import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calendarDay, calendarDays, fillUsageDays, formatUsageDay, rangeLabel } from "../src/model/usage-range.js";

describe("período de uso", () => {
  it("nomeia uma janela de um dia como 24 horas", () => {
    assert.equal(rangeLabel(1), "24 horas");
    assert.equal(rangeLabel(7), "7 dias");
  });

  it("lista cada dia UTC na janela, então 7d e 90d têm tamanhos diferentes", () => {
    const until = new Date("2026-09-15T18:00:00.000Z");
    const week = calendarDays("2026-09-09T18:00:00.000Z", until);
    const quarter = calendarDays("2026-06-18T18:00:00.000Z", until);
    assert.equal(week[0], "2026-09-09");
    assert.equal(week.at(-1), "2026-09-15");
    assert.equal(week.length, 7);
    assert.ok(quarter.length >= 89 && quarter.length <= 91);
  });

  it("mantém dias sem chamadas para o gráfico ainda cobrir o período escolhido", () => {
    const until = new Date("2026-09-15T12:00:00.000Z");
    const filled = fillUsageDays(
      [{ day: "2026-09-14", cost: 3.68 }],
      { since: "2026-09-09T12:00:00.000Z", days: 7 },
      (day) => ({ day, cost: 0 }),
      until,
    );
    assert.equal(filled.length, 7);
    assert.equal(filled.find((row) => row.day === "2026-09-14")?.cost, 3.68);
    assert.equal(filled.filter((row) => row.cost === 0).length, 6);
  });

  it("conta os dias no fuso do usuário: 22h30 em São Paulo ainda é o mesmo dia", () => {
    const lateEvening = new Date("2026-10-03T01:30:00.000Z");
    assert.equal(calendarDay(lateEvening), "2026-10-03");
    assert.equal(calendarDay(lateEvening, "America/Sao_Paulo"), "2026-10-02");
    assert.equal(calendarDay(lateEvening, "Nao/Existe"), "2026-10-03");
    const days = calendarDays("2026-09-26T01:30:00.000Z", lateEvening, "America/Sao_Paulo");
    assert.equal(days[0], "2026-09-25");
    assert.equal(days.at(-1), "2026-10-02");
    const filled = fillUsageDays(
      [{ day: "2026-10-02", cost: 1 }],
      { since: "2026-09-26T01:30:00.000Z", days: 7, timeZone: "America/Sao_Paulo" },
      (day) => ({ day, cost: 0 }),
      lateEvening,
    );
    assert.equal(filled.at(-1)?.cost, 1);
  });

  it("mostra os dias do gráfico como dia/mês", () => {
    assert.equal(formatUsageDay("2026-10-03"), "03/10");
    assert.equal(formatUsageDay(""), "");
  });
});
