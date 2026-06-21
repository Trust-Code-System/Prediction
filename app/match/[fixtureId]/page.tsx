import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatchView } from "@/lib/data/match";
import { formatKickoff, leadingOutcome, leanLabel } from "@/lib/format";
import { Disclaimer } from "@/components/Disclaimer";
import { MatchChat } from "@/components/MatchChat";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { Expandable } from "@/components/Expandable";
import {
  BestAngleBanner,
  FormList,
  GoalsMarketCard,
  H2HList,
  InjuriesList,
  MatchOfficial,
  NewsList,
  PlayerToWatchCard,
  RiskMeter,
  SquadTable,
  StandingsContext,
  TacticalComparison,
  TeamStrengthComparison,
  VenueRecordView,
  WhatCouldChangeList
} from "@/components/MatchSections";
import { computeTeamStrength } from "@/lib/ratings/team";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: { fixtureId: string } }) {
  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isInteger(fixtureId)) notFound();

  const view = await getMatchView(fixtureId);
  if (!view) notFound();

  const homeName = view.homeTeam?.name ?? "Home";
  const awayName = view.awayTeam?.name ?? "Away";
  const prediction = view.prediction;

  // Resolve the player-to-watch stat row from either squad.
  const ptwId = prediction?.player_to_watch?.player_id;
  const ptwPlayer =
    ptwId != null
      ? [...view.homePlayers, ...view.awayPlayers].find((p) => p.id === ptwId) ?? null
      : null;

  // Team strength is computed at read time from the cached view (no DB/pipeline).
  const homeStrength = computeTeamStrength({
    standing: view.homeStanding,
    form: view.homeForm,
    players: view.homePlayers
  });
  const awayStrength = computeTeamStrength({
    standing: view.awayStanding,
    form: view.awayForm,
    players: view.awayPlayers
  });

  return (
    <article className="space-y-5 py-6">
      <div>
        <Link href="/" className="text-sm text-pitch-700 hover:underline">
          &lt; All matches
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {homeName} <span className="text-slate-400">vs</span> {awayName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {view.league?.name ?? "League"} | {formatKickoff(view.fixture.kickoff_at)}
          {view.venue?.name ? ` | ${view.venue.name}` : ""}
        </p>
      </div>

      {/* VERDICT */}
      {prediction && prediction.status === "published" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Lean</div>
              <div className="text-xl font-semibold">
                {leanLabel(
                  leadingOutcome(prediction.outcome_probs),
                  homeName,
                  awayName
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {prediction.scoreline_lean ? (
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 text-sm font-semibold tabular-nums">
                    {prediction.scoreline_lean}
                  </span>
                ) : null}
                <ConfidenceBadge confidence={prediction.confidence} />
              </div>
              {prediction.risk_level ? <RiskMeter level={prediction.risk_level} /> : null}
            </div>
          </div>

          <div className="mt-4">
            <ProbabilityBar
              probs={prediction.outcome_probs}
              homeTeam={homeName}
              awayTeam={awayName}
            />
          </div>

          {prediction.rationale ? (
            <p className="mt-4 text-sm leading-relaxed text-slate-700">{prediction.rationale}</p>
          ) : null}

          {prediction.key_factors && prediction.key_factors.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              {prediction.key_factors.map((k, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-pitch-600">-</span>
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {prediction.best_angle || prediction.goals_market ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {prediction.best_angle ? <BestAngleBanner angle={prediction.best_angle} /> : null}
              {prediction.goals_market ? <GoalsMarketCard market={prediction.goals_market} /> : null}
            </div>
          ) : null}

          {prediction.what_could_change && prediction.what_could_change.length > 0 ? (
            <div className="mt-3">
              <WhatCouldChangeList items={prediction.what_could_change} />
            </div>
          ) : null}

          <div className="mt-4">
            <Disclaimer />
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-base font-medium">Analysis not ready yet</div>
          <p className="mt-1 text-sm text-slate-600">
            The verdict for this fixture has not been generated or is awaiting review. The
            supporting data below is still available to explore.
          </p>
          <div className="mt-4">
            <Disclaimer />
          </div>
        </section>
      )}

      {/* PLAYER TO WATCH */}
      {prediction?.status === "published" && prediction.player_to_watch ? (
        <PlayerToWatchCard ptw={prediction.player_to_watch} player={ptwPlayer} />
      ) : null}

      {/* TEAM STRENGTH COMPARISON (hides itself when neither side has data) */}
      <TeamStrengthComparison
        home={homeStrength}
        away={awayStrength}
        homeName={homeName}
        awayName={awayName}
      />

      {/* TACTICAL COMPARISON (hides itself when no analysis is stored) */}
      <TacticalComparison tactical={view.tactical} homeName={homeName} awayName={awayName} />

      {/* AI ANALYST CHAT (only when there is a published prediction to ground it) */}
      {prediction?.status === "published" ? <MatchChat fixtureId={fixtureId} /> : null}

      {/* VERIFIABLE SECTIONS */}
      <div className="space-y-3">
        <Expandable title={`Squad and season stats: ${homeName}`}>
          <SquadTable players={view.homePlayers} />
        </Expandable>
        <Expandable title={`Squad and season stats: ${awayName}`}>
          <SquadTable players={view.awayPlayers} />
        </Expandable>

        <Expandable title="Last 5 form" defaultOpen>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium">{homeName}</div>
              <FormList
                last5={view.homeForm?.last5 ?? null}
                newsSummary={view.news?.signals?.home_form_summary ?? null}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">{awayName}</div>
              <FormList
                last5={view.awayForm?.last5 ?? null}
                newsSummary={view.news?.signals?.away_form_summary ?? null}
              />
            </div>
          </div>
        </Expandable>

        <Expandable title="Head to head">
          <H2HList history={view.h2h?.history ?? null} />
        </Expandable>

        <Expandable title="Venue record">
          <div className="space-y-2">
            <VenueRecordView
              label={`${homeName} at ${view.venue?.name ?? "this venue"}`}
              record={view.homeVenueRecord?.record ?? null}
            />
            <VenueRecordView
              label={`${awayName} away record`}
              record={view.awayVenueRecord?.record ?? null}
            />
          </div>
        </Expandable>

        <Expandable title="Injuries and unavailable">
          <InjuriesList
            injuries={view.injuries}
            homeTeamId={view.fixture.home_team_id}
            homeName={homeName}
            awayName={awayName}
            newsInjuries={view.news?.signals?.injuries ?? undefined}
          />
        </Expandable>

        <Expandable title="Standings context">
          <StandingsContext
            home={view.homeStanding}
            away={view.awayStanding}
            homeName={homeName}
            awayName={awayName}
          />
        </Expandable>

        {view.refereeName ? (
          <Expandable title="Match official">
            <MatchOfficial name={view.refereeName} profile={view.referee} />
          </Expandable>
        ) : null}

        <Expandable title="Latest news" subtitle="external reports">
          <NewsList items={view.news?.items ?? null} />
        </Expandable>
      </div>
    </article>
  );
}
