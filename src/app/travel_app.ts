/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FLIGHT_DATABASE, findFlight } from './flight_data.ts';
import type { BookingState } from './types.ts';
import { isWebMCPSupported } from '../adk-webmcp/index.ts';

export class TravelApp {
  private state: BookingState = {
    searchQuery: {
      origin: 'SFO',
      destination: 'HND',
      cabinClass: 'Economy',
    },
    availableFlights: FLIGHT_DATABASE.filter(
      (f) => f.origin === 'SFO' && f.destination === 'HND'
    ),
    selectedFlightId: 'SB-101',
    amenities: {
      seatPreference: 'Window',
      mealPreference: 'Standard Gourmet',
      extraBaggageCount: 1,
    },
    passenger: null,
    bookingStatus: 'flight_selected',
    confirmationNumber: null,
  };

  private container: HTMLElement;
  private onToolActivityCallback?: (toolName: string, args: any, result: any) => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setToolActivityCallback(cb: (toolName: string, args: any, result: any) => void) {
    this.onToolActivityCallback = cb;
  }

  getState(): Readonly<BookingState> {
    return this.state;
  }

  /**
   * Registers WebMCP tools with Chrome's native document.modelContext
   */
  async initWebMCPTools(): Promise<boolean> {
    if (!isWebMCPSupported()) {
      console.warn('Chrome WebMCP is not available on document.modelContext.');
      this.render();
      return false;
    }

    const modelContext = document.modelContext!;

    // 1. search_flights
    await modelContext.registerTool({
      name: 'search_flights',
      title: 'Search Flights',
      description:
        'Search available flights by destination (city or 3-letter IATA code, e.g. Tokyo/HND, London/LHR, Paris/CDG, New York/JFK) and optional origin and cabin class (Economy, Premium Economy, Business, First). Returns flight numbers, departure/arrival times, aircraft, and pricing in USD.',
      inputSchema: {
        type: 'object',
        properties: {
          destination: {
            type: 'string',
            description: 'Destination city name or 3-letter airport code (e.g. Tokyo, HND, London, LHR, Paris, CDG, New York, JFK)',
          },
          origin: {
            type: 'string',
            description: 'Origin city name or airport code (defaults to SFO if not specified)',
          },
          cabinClass: {
            type: 'string',
            enum: ['Economy', 'Premium Economy', 'Business', 'First'],
            description: 'Optional cabin class preference',
          },
        },
        required: ['destination'],
      },
      annotations: {
        readOnlyHint: true,
        consequentialHint: false,
      },
      execute: async (args: any) => {
        const destLower = (args.destination || '').trim().toLowerCase();
        const origLower = (args.origin || 'SFO').trim().toLowerCase();

        let matches = FLIGHT_DATABASE.filter((flight) => {
          const matchDest =
            flight.destination.toLowerCase() === destLower ||
            flight.destinationCity.toLowerCase().includes(destLower);
          const matchOrig =
            flight.origin.toLowerCase() === origLower ||
            flight.originCity.toLowerCase().includes(origLower);

          if (!matchDest) return false;
          if (args.origin && !matchOrig) return false;
          if (args.cabinClass && flight.cabinClass !== args.cabinClass) return false;
          return true;
        });

        // If no match from default origin, search all origins for this destination
        if (matches.length === 0 && !args.origin) {
          matches = FLIGHT_DATABASE.filter((flight) => {
            const matchDest =
              flight.destination.toLowerCase() === destLower ||
              flight.destinationCity.toLowerCase().includes(destLower);
            if (!matchDest) return false;
            if (args.cabinClass && flight.cabinClass !== args.cabinClass) return false;
            return true;
          });
        }

        this.state.searchQuery = {
          origin: args.origin || 'SFO',
          destination: args.destination,
          cabinClass: args.cabinClass,
        };
        this.state.availableFlights = matches.length > 0 ? matches : FLIGHT_DATABASE.slice(0, 3);
        this.render();
        this.flashElement('#flight-results-card');

        const result = {
          count: this.state.availableFlights.length,
          flights: this.state.availableFlights.map((f) => ({
            id: f.id,
            flightNumber: f.flightNumber,
            route: `${f.origin} (${f.originCity}) -> ${f.destination} (${f.destinationCity})`,
            departure: f.departureTime,
            arrival: f.arrivalTime,
            duration: f.duration,
            cabinClass: f.cabinClass,
            priceUsd: f.priceUsd,
            availableSeats: f.availableSeats,
          })),
          // Spell out the follow-up call so the id does not have to be inferred.
          nextStep:
            this.state.availableFlights.length > 0
              ? `To choose one, call select_flight with flightId set to one of: ${this.state.availableFlights
                  .map((f) => f.id)
                  .join(', ')}`
              : 'No flights matched; try a different destination.',
        };

        this.onToolActivityCallback?.('search_flights', args, result);
        return result;
      },
    });

    // 2. select_flight
    await modelContext.registerTool({
      name: 'select_flight',
      title: 'Select Flight',
      description:
        'Selects a flight from the search results. The flightId argument is required and must be one of the ids returned by search_flights (e.g. SB-101, SB-102, SB-201). Never call this without flightId.',
      inputSchema: {
        type: 'object',
        properties: {
          flightId: {
            type: 'string',
            description: 'The flight ID to select (e.g. SB-101, SB-102, SB-201)',
          },
        },
        required: ['flightId'],
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
      },
      execute: async ({ flightId }: any) => {
        // Throwing surfaces to the model as an opaque "invocation failed", which
        // it cannot act on - it just retries until the session dies. Return the
        // problem and the valid choices so it can correct itself.
        const choices = (
          this.state.availableFlights.length > 0
            ? this.state.availableFlights
            : FLIGHT_DATABASE
        ).map((f) => ({ id: f.id, flightNumber: f.flightNumber, cabinClass: f.cabinClass }));

        if (!flightId || typeof flightId !== 'string' || !flightId.trim()) {
          const result = {
            error: 'missing_argument',
            message:
              'select_flight requires the flightId argument. Call it again with one of availableFlightIds.',
            availableFlightIds: choices,
          };
          this.onToolActivityCallback?.('select_flight', { flightId }, result);
          return result;
        }

        const found = findFlight(flightId);
        if (!found) {
          const result = {
            error: 'unknown_flight',
            message: `No flight matches '${flightId}'. Use one of availableFlightIds.`,
            availableFlightIds: choices,
          };
          this.onToolActivityCallback?.('select_flight', { flightId }, result);
          return result;
        }

        this.state.selectedFlightId = found.id;
        this.state.bookingStatus = 'flight_selected';
        this.render();
        this.flashElement(`#flight-card-${found.id}`);

        const result = {
          selectedFlight: found,
          message: `Selected ${found.airline} ${found.flightNumber} from ${found.originCity} to ${found.destinationCity} ($${found.priceUsd}).`,
        };
        this.onToolActivityCallback?.('select_flight', { flightId }, result);
        return result;
      },
    });

    // 3. customize_amenities
    await modelContext.registerTool({
      name: 'customize_amenities',
      title: 'Customize Amenities',
      description:
        'Customizes seat preference (Window, Aisle, Extra Legroom Exit Row), in-flight meal (Standard Gourmet, Vegetarian, Vegan, Halal, Kosher), and extra baggage count (0 to 3 bags).',
      inputSchema: {
        type: 'object',
        properties: {
          seatPreference: {
            type: 'string',
            enum: ['Window', 'Aisle', 'Extra Legroom Exit Row'],
            description: 'Preferred seating location',
          },
          mealPreference: {
            type: 'string',
            enum: ['Standard Gourmet', 'Vegetarian', 'Vegan', 'Halal', 'Kosher'],
            description: 'Meal option',
          },
          extraBaggageCount: {
            type: 'number',
            description: 'Number of extra checked bags (0-3). Each extra bag costs $50.',
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
      },
      execute: async (args: any) => {
        if (args.seatPreference) {
          this.state.amenities.seatPreference = args.seatPreference;
        }
        if (args.mealPreference) {
          this.state.amenities.mealPreference = args.mealPreference;
        }
        if (typeof args.extraBaggageCount === 'number') {
          this.state.amenities.extraBaggageCount = Math.max(0, Math.min(3, args.extraBaggageCount));
        }

        this.state.bookingStatus = 'amenities_configured';
        this.render();
        this.flashElement('#amenities-card');

        const result = {
          updatedAmenities: this.state.amenities,
          message: 'Amenities updated successfully.',
        };
        this.onToolActivityCallback?.('customize_amenities', args, result);
        return result;
      },
    });

    // 4. confirm_booking (Consequential Action)
    await modelContext.registerTool({
      name: 'confirm_booking',
      title: 'Confirm Flight Booking',
      description:
        'Locks in and confirms the flight reservation with passenger legal name, email address, and optional frequent flyer number. Note: this is a consequential real-world booking action.',
      inputSchema: {
        type: 'object',
        properties: {
          passengerName: {
            type: 'string',
            description: 'Full legal name of traveler (e.g. "Jane Doe")',
          },
          contactEmail: {
            type: 'string',
            description: 'Email address for ticketing receipt (e.g. "jane.doe@example.com")',
          },
          frequentFlyerNumber: {
            type: 'string',
            description: 'Optional frequent flyer loyalty account number',
          },
        },
        required: ['passengerName', 'contactEmail'],
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: true,
      },
      execute: async (args: any) => {
        const flight = FLIGHT_DATABASE.find((f) => f.id === this.state.selectedFlightId);
        if (!flight) {
          const result = {
            error: 'no_flight_selected',
            message: 'Call select_flight before confirm_booking.',
            availableFlightIds: this.state.availableFlights.map((f) => f.id),
          };
          this.onToolActivityCallback?.('confirm_booking', args, result);
          return result;
        }
        if (!args?.passengerName || !args?.contactEmail) {
          const result = {
            error: 'missing_argument',
            message:
              'confirm_booking requires both passengerName and contactEmail. Ask the traveler for whichever is missing, then call again.',
            received: { passengerName: args?.passengerName, contactEmail: args?.contactEmail },
          };
          this.onToolActivityCallback?.('confirm_booking', args, result);
          return result;
        }

        const confirmationCode = 'SB-' + Math.floor(100000 + Math.random() * 900000);
        this.state.passenger = {
          name: args.passengerName,
          email: args.contactEmail,
          frequentFlyerNumber: args.frequentFlyerNumber,
        };
        this.state.confirmationNumber = confirmationCode;
        this.state.bookingStatus = 'confirmed';

        this.render();
        this.flashElement('#confirmation-card');

        const totalCost = flight.priceUsd + this.state.amenities.extraBaggageCount * 50;

        const result = {
          confirmationNumber: confirmationCode,
          status: 'ISSUED_AND_CONFIRMED',
          flightNumber: flight.flightNumber,
          route: `${flight.originCity} (${flight.origin}) -> ${flight.destinationCity} (${flight.destination})`,
          departure: flight.departureTime,
          passenger: this.state.passenger.name,
          email: this.state.passenger.email,
          seat: this.state.amenities.seatPreference,
          meal: this.state.amenities.mealPreference,
          extraBags: this.state.amenities.extraBaggageCount,
          totalPriceUsd: totalCost,
          message: `Booking successfully confirmed! Confirmation code: ${confirmationCode}.`,
        };

        this.onToolActivityCallback?.('confirm_booking', args, result);
        return result;
      },
    });

    // 5. get_current_itinerary
    await modelContext.registerTool({
      name: 'get_current_itinerary',
      title: 'Get Current Itinerary',
      description:
        'Retrieves the current draft or confirmed itinerary, selected flight details, chosen amenities, passenger info, total price, and booking status.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        consequentialHint: false,
      },
      execute: async () => {
        const flight = FLIGHT_DATABASE.find((f) => f.id === this.state.selectedFlightId) || null;
        const totalCost = flight ? flight.priceUsd + this.state.amenities.extraBaggageCount * 50 : 0;

        const result = {
          bookingStatus: this.state.bookingStatus,
          confirmationNumber: this.state.confirmationNumber,
          selectedFlight: flight,
          amenities: this.state.amenities,
          passenger: this.state.passenger,
          totalPriceUsd: totalCost,
        };

        this.onToolActivityCallback?.('get_current_itinerary', {}, result);
        return result;
      },
    });

    this.render();
    return true;
  }

  private flashElement(selector: string) {
    const el = this.container.querySelector(selector);
    if (el) {
      el.classList.add('ring-4', 'ring-cyan-400', 'bg-cyan-950/40', 'transition-all', 'duration-500');
      setTimeout(() => {
        el.classList.remove('ring-4', 'ring-cyan-400', 'bg-cyan-950/40');
      }, 1600);
    }
  }

  render() {
    const isSupported = isWebMCPSupported();
    const selectedFlight = FLIGHT_DATABASE.find((f) => f.id === this.state.selectedFlightId);
    const totalPrice = selectedFlight
      ? selectedFlight.priceUsd + this.state.amenities.extraBaggageCount * 50
      : 0;

    this.container.innerHTML = `
      <div class="h-full flex flex-col space-y-4">
        <!-- Header & WebMCP Badge -->
        <div class="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-bold text-slate-100">
                SkyBreeze Airways
              </h2>
              <p class="text-xs text-slate-400">Target Web App exposing tools via <code class="text-cyan-400">document.modelContext</code></p>
            </div>
          </div>
        </div>

        ${
          !isSupported
            ? `
          <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start space-x-3">
            <svg class="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <div class="font-bold text-amber-300">Chrome WebMCP Not Enabled</div>
              <p class="mt-1 leading-relaxed">
                To experience 100% native WebMCP tool actuation:
                <br />1. Open <b>Chrome Canary / Dev</b>.
                <br />2. Navigate to <code class="bg-black/40 px-1 py-0.5 rounded text-amber-300">chrome://flags/#enable-webmcp-testing</code>.
                <br />3. Set flag to <b>Enabled</b> and relaunch Chrome.
              </p>
            </div>
          </div>
        `
            : ''
        }

        <!-- Search Bar -->
        <div class="bg-slate-800/60 rounded-xl p-3.5 border border-slate-700/60 backdrop-blur-sm">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Search Flight Options</div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-slate-400">Origin</label>
              <input type="text" id="input-origin" value="${this.state.searchQuery.origin}" class="w-full mt-1 px-2.5 py-1.5 bg-slate-900/80 border border-slate-700 rounded-lg text-sm font-medium text-slate-100 focus:outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label class="text-[11px] text-slate-400">Destination</label>
              <input type="text" id="input-destination" value="${this.state.searchQuery.destination}" class="w-full mt-1 px-2.5 py-1.5 bg-slate-900/80 border border-slate-700 rounded-lg text-sm font-medium text-slate-100 focus:outline-none focus:border-cyan-500" />
            </div>
          </div>
        </div>

        <!-- Available Flights List -->
        <div id="flight-results-card" class="flex-1 bg-slate-800/60 rounded-xl p-3.5 border border-slate-700/60 backdrop-blur-sm overflow-y-auto">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Matching Flights (${this.state.availableFlights.length})
            </span>
            <span class="text-[11px] text-cyan-400 font-mono">tool: select_flight({ flightId })</span>
          </div>

          <div class="space-y-2.5">
            ${this.state.availableFlights
              .map((flight) => {
                const isSelected = flight.id === this.state.selectedFlightId;
                return `
                <div id="flight-card-${flight.id}" data-flight-id="${flight.id}" class="flight-card cursor-pointer p-3 rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-900/20'
                    : 'bg-slate-900/60 border-slate-700/60 hover:border-slate-600'
                }">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-2">
                      <span class="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">${flight.id}</span>
                      <span class="text-sm font-semibold text-slate-200">${flight.flightNumber}</span>
                      <span class="text-xs text-slate-400">• ${flight.aircraft}</span>
                    </div>
                    <div class="text-right">
                      <div class="text-base font-bold text-emerald-400">$${flight.priceUsd}</div>
                      <div class="text-[10px] text-slate-400">${flight.cabinClass}</div>
                    </div>
                  </div>
                  <div class="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <div>
                      <span class="font-bold text-slate-100">${flight.origin}</span> (${flight.originCity})
                      <span class="text-slate-400 text-[11px] block">${flight.departureTime}</span>
                    </div>
                    <div class="text-center px-2">
                      <span class="text-[10px] text-slate-400 block">${flight.duration}</span>
                      <div class="w-16 h-0.5 bg-slate-600 relative my-0.5">
                        <div class="w-1.5 h-1.5 bg-cyan-400 rounded-full absolute -top-0.5 right-0"></div>
                      </div>
                      <span class="text-[9px] text-emerald-400">${flight.availableSeats} seats left</span>
                    </div>
                    <div class="text-right">
                      <span class="font-bold text-slate-100">${flight.destination}</span> (${flight.destinationCity})
                      <span class="text-slate-400 text-[11px] block">${flight.arrivalTime}</span>
                    </div>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>

        <!-- Amenities & Confirmation Panel -->
        <div id="amenities-card" class="bg-slate-800/60 rounded-xl p-3.5 border border-slate-700/60 backdrop-blur-sm">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Amenities & Passenger</span>
            <span class="text-[11px] text-cyan-400 font-mono">tool: customize_amenities</span>
          </div>

          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-700/60">
              <span class="text-slate-400 block text-[10px]">Seat Location</span>
              <span class="font-bold text-slate-200">${this.state.amenities.seatPreference}</span>
            </div>
            <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-700/60">
              <span class="text-slate-400 block text-[10px]">In-Flight Meal</span>
              <span class="font-bold text-slate-200">${this.state.amenities.mealPreference}</span>
            </div>
            <div class="bg-slate-900/60 p-2 rounded-lg border border-slate-700/60">
              <span class="text-slate-400 block text-[10px]">Checked Luggage</span>
              <span class="font-bold text-slate-200">${this.state.amenities.extraBaggageCount} Bag (${this.state.amenities.extraBaggageCount * 50 > 0 ? '+$' + this.state.amenities.extraBaggageCount * 50 : 'Included'})</span>
            </div>
          </div>
        </div>

        <!-- Booking Status Card -->
        <div id="confirmation-card" class="p-3.5 rounded-xl border ${
          this.state.bookingStatus === 'confirmed'
            ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-200'
            : 'bg-slate-800/60 border-slate-700/60 text-slate-300'
        }">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[10px] uppercase tracking-wider font-semibold ${
                this.state.bookingStatus === 'confirmed' ? 'text-emerald-400' : 'text-slate-400'
              }">
                ${this.state.bookingStatus === 'confirmed' ? 'Booking Confirmed' : 'Booking Draft'}
              </div>
              <div class="text-sm font-bold text-slate-100 mt-0.5">
                ${
                  this.state.confirmationNumber
                    ? `Reservation #${this.state.confirmationNumber}`
                    : selectedFlight
                    ? `${selectedFlight.flightNumber} to ${selectedFlight.destinationCity}`
                    : 'No flight selected'
                }
              </div>
              ${
                this.state.passenger
                  ? `<div class="text-xs text-slate-300 mt-0.5">Passenger: ${this.state.passenger.name} (${this.state.passenger.email})</div>`
                  : ''
              }
            </div>
            <div class="text-right">
              <div class="text-[10px] text-slate-400">Total Price</div>
              <div class="text-base font-extrabold text-emerald-400">$${totalPrice} USD</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    this.container.querySelectorAll('.flight-card').forEach((el) => {
      el.addEventListener('click', () => {
        const flightId = el.getAttribute('data-flight-id');
        if (flightId) {
          this.state.selectedFlightId = flightId;
          this.state.bookingStatus = 'flight_selected';
          this.render();
        }
      });
    });
  }
}
