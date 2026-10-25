/** Karsten's MDFC land term (5.4a), shared by the generated deck and its saved build report. */
export interface LandTermFields {
  /** The summed land worth of the spell/land MDFCs the auto land count subtracted (0.38 each,
   *  0.74 mythic). A saved deck's analysis passes it back so its land target matches generation. */
  mdfcLandTerm?: number;
}
