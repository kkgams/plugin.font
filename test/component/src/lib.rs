#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use wasmtime::component::{Component, Linker, ResourceTable};
    use wasmtime::{Config, Engine, Store};
    use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxView, WasiView};
    wasmtime::component::bindgen!({ path: "../../wit", world: "font-plugin" });
    use exports::gams::font::font::{
        AtlasType, Config as FontConfig, Dimensions, EdgeColoring, ErrorCode, FontError,
        PixelFormat,
    };
    struct State {
        wasi: WasiCtx,
        table: ResourceTable,
    }
    impl WasiView for State {
        fn ctx(&mut self) -> WasiCtxView<'_> {
            WasiCtxView {
                ctx: &mut self.wasi,
                table: &mut self.table,
            }
        }
    }
    fn error<T: std::fmt::Debug>(result: Result<T, FontError>, code: ErrorCode) {
        let failure = result.unwrap_err();
        assert_eq!(failure.code, code);
        assert!(!failure.message.is_empty());
    }
    #[test]
    fn component_generation_roundtrip_resources_and_filesystem() -> wasmtime::Result<()> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let directory = root.join("build.nosync/component-fixtures");
        std::fs::create_dir_all(&directory)?;
        let bytes = std::fs::read(root.join("test/fixtures/test-font.ttf"))?;
        std::fs::write(directory.join("fixture.ttf"), &bytes)?;
        let mut config = Config::new();
        config.wasm_component_model(true).wasm_exceptions(true);
        let engine = Engine::new(&config)?;
        let component = Component::from_file(
            &engine,
            PathBuf::from(
                std::env::var_os("FONT_COMPONENT_PATH")
                    .expect("FONT_COMPONENT_PATH selects the test component"),
            ),
        )?;
        let mut linker = Linker::<State>::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
        let mut wasi = WasiCtx::builder();
        wasi.preopened_dir(&directory, "/", DirPerms::all(), FilePerms::all())?;
        let mut store = Store::new(
            &engine,
            State {
                wasi: wasi.build(),
                table: ResourceTable::new(),
            },
        );
        let instance = FontPlugin::instantiate(&mut store, &component, &linker)?;
        let font = instance.gams_font_font();
        assert!(font.call_info(&mut store)?.starts_with("plugin.font "));
        let mut settings = FontConfig {
            atlas_type: AtlasType::Mtsdf,
            codepoints: vec![32, 65, 86],
            size: 32.,
            distance_range: 4.,
            dimensions: None,
            edge_coloring: EdgeColoring::InkTrap,
            miter_limit: 1.,
        };
        for (kind, channels, format) in [
            (AtlasType::Sdf, 1, PixelFormat::R8),
            (AtlasType::Psdf, 1, PixelFormat::R8),
            (AtlasType::Msdf, 3, PixelFormat::Rgb8),
            (AtlasType::Mtsdf, 4, PixelFormat::Rgba8),
        ] {
            settings.atlas_type = kind;
            let resource = font.call_generate(&mut store, &bytes, &settings)?.unwrap();
            let info = font.call_atlas_info(&mut store, resource)?;
            let pixels = font.call_atlas_pixels(&mut store, resource)?;
            assert_eq!(info.atlas_type, kind);
            assert_eq!(info.pixel_format, format);
            assert_eq!(info.size, 32.);
            assert_eq!(info.distance_range, 4.);
            assert_eq!(
                pixels.len(),
                (info.dimensions.width * info.dimensions.height * channels) as usize
            );
            assert!(pixels.iter().any(|v| *v != pixels[0]));
            let metadata = font.call_metadata_json(&mut store, resource)?;
            let json: serde_json::Value = serde_json::from_str(&metadata)?;
            assert_eq!(json["atlas"]["yOrigin"], "bottom");
            assert_eq!(json["atlas"]["distanceRange"], 4);
            assert_eq!(
                json["glyphs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|g| g["unicode"].as_u64().unwrap())
                    .collect::<Vec<_>>(),
                vec![32, 65, 86]
            );
            assert!(json["kerning"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["unicode1"] == 65
                    && p["unicode2"] == 86
                    && p["advance"].as_f64().unwrap() < 0.));
            let encoded = font.call_encode(&mut store, resource)?.unwrap();
            let decoded = font.call_decode(&mut store, &encoded)?.unwrap();
            assert_eq!(
                format!("{:?}", font.call_atlas_info(&mut store, decoded)?),
                format!("{info:?}")
            );
            assert_eq!(font.call_atlas_pixels(&mut store, decoded)?, pixels);
            assert_eq!(font.call_metadata_json(&mut store, decoded)?, metadata);
            assert_eq!(font.call_encode(&mut store, decoded)?.unwrap(), encoded);
            decoded.resource_drop(&mut store)?;
            let mut corrupt = encoded;
            let last = corrupt.len() - 1;
            corrupt[last] ^= 1;
            error(
                font.call_decode(&mut store, &corrupt)?,
                ErrorCode::InvalidArtery,
            );
            resource.resource_drop(&mut store)?;
        }
        let resource = font
            .call_generate_file(&mut store, "/fixture.ttf", &settings)?
            .unwrap();
        let encoded = font.call_encode(&mut store, resource)?.unwrap();
        assert_eq!(
            font.call_save(&mut store, resource, "/output.arfont")?
                .unwrap(),
            encoded.len() as u64
        );
        assert_eq!(std::fs::read(directory.join("output.arfont"))?, encoded);
        let opened = font.call_open(&mut store, "/output.arfont")?.unwrap();
        assert_eq!(
            font.call_atlas_pixels(&mut store, opened)?,
            font.call_atlas_pixels(&mut store, resource)?
        );
        opened.resource_drop(&mut store)?;
        error(
            font.call_save(&mut store, resource, "/absent/output.arfont")?,
            ErrorCode::IoError,
        );
        resource.resource_drop(&mut store)?;
        error(
            font.call_open(&mut store, "/missing.arfont")?,
            ErrorCode::IoError,
        );
        error(
            font.call_open(&mut store, "/../outside.arfont")?,
            ErrorCode::IoError,
        );
        error(
            font.call_generate(&mut store, &[1, 2, 3], &settings)?,
            ErrorCode::InvalidFont,
        );
        for (codepoints, expected) in [
            (vec![], ErrorCode::InvalidConfig),
            (vec![0xd800], ErrorCode::InvalidConfig),
            (vec![0x10ffff], ErrorCode::MissingGlyph),
        ] {
            let mut bad = settings.clone();
            bad.codepoints = codepoints;
            error(font.call_generate(&mut store, &bytes, &bad)?, expected);
        }
        let mut bad = settings.clone();
        bad.dimensions = Some(Dimensions {
            width: 1,
            height: 1,
        });
        error(
            font.call_generate(&mut store, &bytes, &bad)?,
            ErrorCode::AtlasTooSmall,
        );
        bad = settings.clone();
        bad.size = f64::NAN;
        error(
            font.call_generate(&mut store, &bytes, &bad)?,
            ErrorCode::InvalidConfig,
        );
        for _ in 0..100 {
            let resource = font.call_generate(&mut store, &bytes, &settings)?.unwrap();
            resource.resource_drop(&mut store)?;
            error(
                font.call_decode(&mut store, &vec![0; 64 * 1024])?,
                ErrorCode::InvalidArtery,
            );
        }
        // A rejected stale handle traps the instance; assert it after other cases.
        let resource = font.call_generate(&mut store, &bytes, &settings)?.unwrap();
        resource.resource_drop(&mut store)?;
        assert!(font.call_atlas_info(&mut store, resource).is_err());
        Ok(())
    }
}
