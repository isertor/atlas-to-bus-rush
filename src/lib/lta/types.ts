// Shapes returned by LTA DataMall's Bus Arrival API (v3).
// Docs: https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html
//
// Endpoint:
//   GET https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival
//       ?BusStopCode=83139[&ServiceNo=15]
//   Header: AccountKey: <your key>

export interface LtaNextBus {
  OriginCode: string;
  DestinationCode: string;
  /** ISO-8601 with +08:00 offset; empty string when no estimate. */
  EstimatedArrival: string;
  Latitude: string;
  Longitude: string;
  /** Visit number on the route. */
  VisitNumber: string;
  /** "SEA" | "SDA" | "LSD" | "" */
  Load: string;
  /** "WAB" if wheelchair accessible, else "". */
  Feature: string;
  /** "SD" | "DD" | "BD" */
  Type: string;
  /** "1" if live-tracked, "0" if schedule-based estimate. */
  Monitored?: number;
}

export interface LtaService {
  ServiceNo: string;
  Operator: string;
  NextBus: LtaNextBus;
  NextBus2: LtaNextBus;
  NextBus3: LtaNextBus;
}

export interface LtaBusArrivalResponse {
  BusStopCode: string;
  Services: LtaService[];
}
