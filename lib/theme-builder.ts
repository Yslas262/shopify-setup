import type { ThemeConfig } from "@/types/onboarding";

function generateId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export function buildSettingsData(config: ThemeConfig): object {
  return {
    current: {
      logo: config.logoId,
      favicon: config.faviconId,
      logo_width: 200,
      mobile_logo_width: 120,

      colors_accent_1: config.primaryColor,
      colors_accent_2: config.secondaryColor,
      colors_text: "#000000",
      colors_outline_button_labels: config.primaryColor,
      colors_solid_button_labels: "#FFFFFF",
      colors_background_1: "#FFFFFF",
      colors_background_2: "#F3F3F3",
    },
    presets: {},
  };
}

export function buildIndexJson(config: ThemeConfig): object {
  const collectionBlocks: Record<string, object> = {};
  const blockOrder: string[] = [];

  config.collections.forEach((col) => {
    const blockId = `featured_collection_${generateId()}`;
    collectionBlocks[blockId] = {
      type: "featured_collection",
      settings: {
        collection: col.handle,
        custom_title: "",
      },
    };
    blockOrder.push(blockId);
  });

  return {
    sections: {
      "cfca4268-6358-426c-98ab-d292aeef11e5": {
        type: "slideshow",
        blocks: {
          slide_cbnAfz: {
            type: "slide",
            settings: {
              image: config.bannerDesktopId,
              mobile_image: config.bannerMobileId,
              image_overlay_opacity: 0,
              heading: "",
              box_align: "middle-center",
              show_text_box: false,
              text_alignment: "center",
              color_scheme: "background-1",
            },
          },
        },
        block_order: ["slide_cbnAfz"],
        settings: {
          visibility: "always-display",
          layout: "full_bleed",
          slide_height: "adapt_image",
          auto_rotate: true,
          change_slides_speed: 5,
        },
      },

      collection_list_AtphXm: {
        type: "collection-list",
        blocks: collectionBlocks,
        block_order: blockOrder,
        settings: {
          visibility: "always-display",
          title: "Our Collections",
          title_highlight_color: "#6d388b",
          heading_size: "h1",
          image_ratio: "square",
          color_scheme: "background-1",
          columns_desktop: Math.max(1, Math.min(config.collections.length, 5)),
          columns_mobile: "2",
          slider_desktop: true,
          slider_mobile: true,
          per_move_desktop: 1,
          padding_top: 0,
          padding_bottom: 36,
        },
      },

      featured_collection_KiQXEe: {
        type: "featured-collection",
        settings: {
          visibility: "always-display",
          title: "Best Sellers",
          title_highlight_color: "#a7d92f",
          heading_size: "h1",
          collection: "best-sellers",
          products_to_show: 10,
          show_view_all: true,
          view_all_style: "solid",
          image_ratio: "square",
          show_secondary_image: true,
          columns_desktop: 4,
          columns_mobile: "2",
          padding_top: 0,
          padding_bottom: 36,
          color_scheme: "background-1",
        },
      },

      "6aa09428-a417-429d-9159-a4e8afd49590": {
        type: "icon-bar",
        blocks: {
          "col-1": {
            type: "column",
            settings: {
              icon: "local_shipping",
              title: "Free Shipping",
              text: "<p>Free Delivery for You</p>",
            },
          },
          "col-2": {
            type: "column",
            settings: {
              icon: "security",
              title: "Secure Payment",
              text: "<p>Safe Environment for Online Shopping</p>",
            },
          },
          "col-3": {
            type: "column",
            settings: {
              icon: "headset_mic",
              title: "Support",
              text: "<p>Customer Service from Monday to Friday, 8 AM to 6 PM</p>",
            },
          },
        },
        block_order: ["col-1", "col-2", "col-3"],
        settings: {
          visibility: "always-display",
          columns_desktop: 3,
          columns_mobile: "1",
          color_scheme: "background-1",
          padding_top: 36,
          padding_bottom: 36,
        },
      },
    },
    order: [
      "cfca4268-6358-426c-98ab-d292aeef11e5",
      "collection_list_AtphXm",
      "featured_collection_KiQXEe",
      "6aa09428-a417-429d-9159-a4e8afd49590",
    ],
  };
}
