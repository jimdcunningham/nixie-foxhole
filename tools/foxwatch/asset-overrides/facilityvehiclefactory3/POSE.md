# Dry Dock Static Catalog Pose

The two SK_DrydockCrane arm instances use frame 0 of the native one-frame `War/Content/Animation/WorldAssets/Drydock/POSE_DrydockCrane_Idle.uasset`. `default.pose.json` contains the existing exporter's reference-relative sample, without authored replacement angles or offsets. The native animation Blueprint also uses this sequence at yaw 0, horizontal distance 855 cm and pulley length 0 cm.

This is the authored idle representation for static catalog art. It is not a claim about the game's runtime no-target state; native BuildArmAnimInstance/AssemblyStation input initialization has not been established. The animation skeleton has two unused Hook1 bones absent from the five-joint mesh; all five mesh bones share the same native reference transforms/parent names.
